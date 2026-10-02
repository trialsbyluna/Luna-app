export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({
      error: "Method not allowed"
    });
  }

  try {
    const { userId, note } = req.body || {};

    if (!note || !note.trim()) {
      return res.status(400).json({
        error: "Please enter what happened."
      });
    }

    if (!process.env.GEMINI_API_KEY) {
      return res.status(500).json({
        error: "Gemini API key is not configured."
      });
    }

    if (!process.env.GOOGLE_SHEETS_WEBHOOK_URL) {
      return res.status(500).json({
        error: "Google Sheets connection is not configured."
      });
    }

    if (!process.env.LUNA_SHEETS_SECRET) {
      return res.status(500).json({
        error: "Google Sheets security token is not configured."
      });
    }

    const today = new Date().toISOString().slice(0, 10);

    const prompt = `
You are Luna, an AI health and nutrition tracking assistant.

Analyze the user's note.

Determine whether it contains:
- FOOD information
- WORKOUT information
- BOTH
- NEITHER

Return ONLY valid JSON.

Use exactly this structure:

{
  "type": "food",
  "foods": [],
  "workouts": []
}

The "type" must be exactly:
"food"
"workout"
"both"
"none"

FOOD OBJECT:

{
  "meal_time": "",
  "meal_type": "",
  "food_item": "",
  "quantity_grams": null,
  "calories": null,
  "protein": null,
  "carbs": null,
  "fat": null,
  "fiber": null,
  "notes": ""
}

WORKOUT OBJECT:

{
  "exercise": "",
  "muscle_group": "",
  "set_number": null,
  "reps_completed": null,
  "weight_value": null,
  "weight_type": "",
  "set_result": "",
  "duration_mins": null,
  "notes": "",
  "estimated_workout_calories": null
}

FOOD RULES:

- Extract every food item mentioned.
- One object per food item.
- Estimate nutrition using common nutritional averages.
- Do not invent food items.
- If there is no food, foods must be [].

WORKOUT RULES:

- Extract every workout mentioned.
- One object per explicitly described set.
- If the user says "3 sets of squats, 10 reps each, 40 kg",
  create 3 objects:
  set 1, set 2, set 3.
- Do not invent sets.
- Do not invent reps.
- Do not invent weight.
- Do not invent exercises.
- If only duration is provided, record duration and leave unknown fields blank.
- Estimate workout calories only when a reasonable estimate is possible.
- If there is no workout, workouts must be [].

IMPORTANT:

Do not turn food into workout information.
Do not turn workout information into food.
Do not invent missing information.

Entry date:
${today}

User ID:
${userId || ""}

User note:
${note}
`;

    const models = [
      "gemini-3.8-flash",
      "gemini-3.5-flash-lite"
    ];

    let response = null;
    let data = null;

    for (const model of models) {
      const maxAttempts = 3;

      for (let attempt = 1; attempt <= maxAttempts; attempt++) {

        response = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
          {
            method: "POST",

            headers: {
              "Content-Type": "application/json",
              "x-goog-api-key": process.env.GEMINI_API_KEY
            },

            body: JSON.stringify({
              contents: [
                {
                  parts: [
                    {
                      text: prompt
                    }
                  ]
                }
              ]
            })
          }
        );

        data = await response.json();

        if (response.ok) {
          console.log(`Gemini succeeded using ${model}`);
          break;
        }

        if (
          response.status === 503 ||
          response.status === 429 ||
          response.status === 408
        ) {
          if (attempt < maxAttempts) {

            const delay =
              Math.pow(2, attempt - 1) * 1000;

            await new Promise((resolve) =>
              setTimeout(resolve, delay)
            );

            continue;
          }
        }

        console.error(`${model} error:`, data);
        break;
      }

      if (response && response.ok) {
        break;
      }
    }

    if (!response || !response.ok) {
      return res.status(503).json({
        error:
          "Gemini is temporarily busy. Please try again in a moment."
      });
    }

    let text =
      data?.candidates?.[0]?.content?.parts?.[0]?.text || "";

    text = text
      .replace(/^```json\s*/i, "")
      .replace(/^```\s*/i, "")
      .replace(/\s*```$/i, "")
      .trim();

    let result;

    try {
      result = JSON.parse(text);
    } catch (error) {

      console.error(
        "Gemini JSON parsing error:",
        error
      );

      console.error(
        "Gemini returned:",
        text
      );

      return res.status(500).json({
        error:
          "Gemini returned an unexpected response."
      });
    }

    const foods =
      Array.isArray(result.foods)
        ? result.foods
        : [];

    const workouts =
      Array.isArray(result.workouts)
        ? result.workouts
        : [];

    const type =
      result.type || "none";

    console.log(
      "Detected type:",
      type
    );

    console.log(
      "Foods:",
      JSON.stringify(foods)
    );

    console.log(
      "Workouts:",
      JSON.stringify(workouts)
    );

    if (
      foods.length === 0 &&
      workouts.length === 0
    ) {
      return res.status(400).json({
        error:
          "Luna could not detect food or workout information.",
        debug: {
          type: type,
          foods: foods,
          workouts: workouts
        }
      });
    }

    const sheetsResponse = await fetch(
      process.env.GOOGLE_SHEETS_WEBHOOK_URL,
      {
        method: "POST",

        headers: {
          "Content-Type": "application/json"
        },

        body: JSON.stringify({
          token:
            process.env.LUNA_SHEETS_SECRET,

          date: today,

          userId:
            userId || "",

          foods: foods,

          workouts: workouts
        })
      }
    );

    const sheetsText =
      await sheetsResponse.text();

    console.log(
      "Google Sheets HTTP status:",
      sheetsResponse.status
    );

    console.log(
      "Google Sheets response:",
      sheetsText
    );

    let sheetsData;

    try {
      sheetsData =
        JSON.parse(sheetsText);
    } catch {

      return res.status(500).json({
        error:
          "Google Sheets did not return valid JSON.",
        debug: {
          httpStatus:
            sheetsResponse.status,

          response:
            sheetsText.substring(0, 500)
        }
      });
    }

    if (
      !sheetsResponse.ok ||
      !sheetsData.success
    ) {
      return res.status(500).json({
        error:
          sheetsData.error ||
          "Google Sheets rejected the request.",

        debug: {
          httpStatus:
            sheetsResponse.status,

          sheetsResponse:
            sheetsData
        }
      });
    }

    return res.status(200).json({

      success: true,

      type: type,

      foods: foods,

      workouts: workouts,

      rowsAdded:
        sheetsData.rowsAdded || 0,

      foodRowsAdded:
        sheetsData.foodRowsAdded || 0,

      workoutRowsAdded:
        sheetsData.workoutRowsAdded || 0
    });

  } catch (error) {

    console.error(
      "Server error:",
      error
    );

    return res.status(500).json({
      error:
        "Something went wrong while processing your entry.",

      debug: {
        message:
          error.message
      }
    });
  }
}
