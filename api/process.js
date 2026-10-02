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

Analyze the user's note and extract FOOD information only.

Return ONLY valid JSON in this exact format:

{
  "foods": [
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
  ]
}

Rules:
1. Extract ALL food items mentioned.
2. Create ONE object per food item.
3. Estimate nutrition using common nutritional averages.
4. Keep food names short.
5. Infer meal type if mentioned.
6. If no food is mentioned, return an empty foods array.
7. Return ONLY valid JSON.
8. Do not provide explanations.

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
            const delay = Math.pow(2, attempt - 1) * 1000;

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
      console.error("All Gemini models failed:", data);

      return res.status(503).json({
        error: "Gemini is temporarily busy. Please try again in a moment."
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
    } catch (parseError) {
      console.error("JSON parsing error:", parseError);
      console.error("Gemini returned:", text);

      return res.status(500).json({
        error: "Gemini returned an unexpected response."
      });
    }

    const foods = Array.isArray(result.foods)
      ? result.foods
      : [];

    console.log("Gemini foods:", JSON.stringify(foods));

    if (foods.length === 0) {
      return res.status(400).json({
        error: "Gemini did not detect any food items.",
        debug: {
          foodsReceivedFromGemini: 0,
          geminiResponse: result
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
          token: process.env.LUNA_SHEETS_SECRET,
          date: today,
          userId: userId || "",
          foods: foods
        })
      }
    );

    const sheetsText = await sheetsResponse.text();

    console.log("Google Sheets HTTP status:", sheetsResponse.status);
    console.log("Google Sheets response:", sheetsText);

    let sheetsData;

    try {
      sheetsData = JSON.parse(sheetsText);
    } catch {
      return res.status(500).json({
        error: "Google Sheets did not return valid JSON.",
        debug: {
          httpStatus: sheetsResponse.status,
          response: sheetsText.substring(0, 500)
        }
      });
    }

    if (!sheetsResponse.ok || !sheetsData.success) {
      return res.status(500).json({
        error: sheetsData.error || "Google Sheets rejected the request.",
        debug: {
          httpStatus: sheetsResponse.status,
          sheetsResponse: sheetsData,
          foodsSent: foods.length
        }
      });
    }

    if (!sheetsData.rowsAdded || sheetsData.rowsAdded === 0) {
      return res.status(500).json({
        error: "Google Sheets reported that zero rows were added.",
        debug: {
          sheetsResponse: sheetsData,
          foodsSent: foods.length
        }
      });
    }

    return res.status(200).json({
      success: true,
      message: "Food processed and saved successfully.",
      foods: foods,
      rowsAdded: sheetsData.rowsAdded
    });

  } catch (error) {
    console.error("Server error:", error);

    return res.status(500).json({
      error: "Something went wrong while processing your entry.",
      debug: {
        message: error.message
      }
    });
  }
}
