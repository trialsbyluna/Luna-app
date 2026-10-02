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

    const today =
      new Date().toISOString().slice(0, 10);

    const prompt = `
You are Luna, an AI health and wellness tracking assistant.

Analyze the user's note and extract ONLY information explicitly present
or reasonably estimable from the information provided.

The note may contain FOOD, WORKOUT, WELLNESS, multiple categories,
or none.

Return ONLY valid JSON matching the requested structure.

IMPORTANT GENERAL RULES:

- Never invent food, workout, or wellness events.
- Extract every explicitly mentioned item.
- Preserve information supplied by the user.
- Use reasonable common nutritional estimates when nutrition is not supplied.
- Use approximate estimates for workout calories only when enough workout
  information exists.
- Estimates must be clearly represented as estimates in the notes where useful.
- If a category is not present, return an empty array.
- Do not turn food into workout information.
- Do not turn workout information into food information.
- Do not turn wellness information into food or workout information.

ENTRY DATE:
${today}

USER ID:
${userId || ""}

USER NOTE:
${note}
`;

    const schema = {
      type: "object",
      properties: {
        type: {
          type: "string",
          enum: [
            "food",
            "workout",
            "wellness",
            "both",
            "food_workout_wellness",
            "food_wellness",
            "workout_wellness",
            "none"
          ]
        },

        foods: {
          type: "array",
          items: {
            type: "object",
            properties: {
              meal_time: {
                type: "string"
              },
              meal_type: {
                type: "string"
              },
              food_item: {
                type: "string"
              },
              quantity_grams: {
                type: ["number", "null"]
              },
              calories: {
                type: ["number", "null"]
              },
              protein: {
                type: ["number", "null"]
              },
              carbs: {
                type: ["number", "null"]
              },
              fat: {
                type: ["number", "null"]
              },
              fiber: {
                type: ["number", "null"]
              },
              notes: {
                type: "string"
              }
            },
            required: [
              "meal_time",
              "meal_type",
              "food_item",
              "quantity_grams",
              "calories",
              "protein",
              "carbs",
              "fat",
              "fiber",
              "notes"
            ]
          }
        },

        workouts: {
          type: "array",
          items: {
            type: "object",
            properties: {
              exercise: {
                type: "string"
              },
              muscle_group: {
                type: "string"
              },
              set_number: {
                type: ["number", "null"]
              },
              reps_completed: {
                type: ["number", "null"]
              },
              weight_value: {
                type: ["number", "null"]
              },
              weight_type: {
                type: "string"
              },
              set_result: {
                type: "string"
              },
              duration_mins: {
                type: ["number", "null"]
              },
              notes: {
                type: "string"
              },
              estimated_workout_calories: {
                type: ["number", "null"]
              }
            },
            required: [
              "exercise",
              "muscle_group",
              "set_number",
              "reps_completed",
              "weight_value",
              "weight_type",
              "set_result",
              "duration_mins",
              "notes",
              "estimated_workout_calories"
            ]
          }
        },

        wellness: {
          type: "array",
          items: {
            type: "object",
            properties: {
              weight: {
                type: ["number", "null"]
              },
              water: {
                type: ["number", "null"]
              },
              sleep: {
                type: ["number", "null"]
              },
              energy: {
                type: ["number", "null"]
              },
              mood: {
                type: "string"
              },
              stress: {
                type: ["number", "null"]
              },
              hunger: {
                type: ["number", "null"]
              },
              cravings: {
                type: "string"
              },
              soreness: {
                type: "string"
              },
              steps: {
                type: ["number", "null"]
              },
              period_day: {
                type: ["number", "null"]
              },
              period_flow: {
                type: "string"
              },
              period_symptoms: {
                type: "string"
              },
              notes: {
                type: "string"
              }
            },
            required: [
              "weight",
              "water",
              "sleep",
              "energy",
              "mood",
              "stress",
              "hunger",
              "cravings",
              "soreness",
              "steps",
              "period_day",
              "period_flow",
              "period_symptoms",
              "notes"
            ]
          }
        }
      },

      required: [
        "type",
        "foods",
        "workouts",
        "wellness"
      ]
    };

    const models = [
      "gemini-3.8-flash",
      "gemini-3.5-flash-lite"
    ];

    let response = null;
    let data = null;

    for (const model of models) {

      const maxAttempts = 3;

      for (
        let attempt = 1;
        attempt <= maxAttempts;
        attempt++
      ) {

        response = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
          {
            method: "POST",

            headers: {
              "Content-Type": "application/json",
              "x-goog-api-key":
                process.env.GEMINI_API_KEY
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
              ],

              generationConfig: {
                responseMimeType:
                  "application/json",

                responseSchema:
                  schema
              }
            })
          }
        );

        data = await response.json();

        if (response.ok) {
          console.log(
            `Gemini succeeded using ${model}`
          );
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

            await new Promise(
              (resolve) =>
                setTimeout(resolve, delay)
            );

            continue;
          }
        }

        console.error(
          `${model} error:`,
          data
        );

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

    const text =
      data?.candidates?.[0]?.content?.parts?.[0]?.text || "";

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

    const wellness =
      Array.isArray(result.wellness)
        ? result.wellness
        : [];

    const type =
      result.type || "none";


    // -----------------------------------------
    // FOOD NORMALIZATION
    // -----------------------------------------

    foods.forEach(function(food) {

      if (
        food.fiber === null ||
        food.fiber === undefined ||
        food.fiber === ""
      ) {

        food.fiber = 0;

        food.notes =
          food.notes
            ? food.notes +
              " Fiber estimated as 0 where negligible."
            : "Fiber estimated as 0 where negligible.";
      }
    });


    // -----------------------------------------
    // WORKOUT NORMALIZATION
    // -----------------------------------------

    workouts.forEach(function(workout) {

      if (
        workout.estimated_workout_calories ===
          null ||
        workout.estimated_workout_calories ===
          undefined ||
        workout.estimated_workout_calories === ""
      ) {

        // Keep the field explicit rather than
        // silently pretending an exact calorie burn.

        workout.estimated_workout_calories = 0;

        workout.notes =
          workout.notes
            ? workout.notes +
              " Workout calorie estimate unavailable."
            : "Workout calorie estimate unavailable.";
      }
    });


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

    console.log(
      "Wellness:",
      JSON.stringify(wellness)
    );


    if (
      foods.length === 0 &&
      workouts.length === 0 &&
      wellness.length === 0
    ) {

      return res.status(400).json({
        error:
          "Luna could not detect food, workout, or wellness information.",

        debug: {
          type: type,
          foods: foods,
          workouts: workouts,
          wellness: wellness
        }
      });
    }


    // -----------------------------------------
    // GOOGLE SHEETS
    // -----------------------------------------

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

          date:
            today,

          userId:
            userId || "",

          foods:
            foods,

          workouts:
            workouts,

          wellness:
            wellness
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

      wellness: wellness,

      rowsAdded:
        sheetsData.rowsAdded || 0,

      foodRowsAdded:
        sheetsData.foodRowsAdded || 0,

      workoutRowsAdded:
        sheetsData.workoutRowsAdded || 0,

      wellnessRowsAdded:
        sheetsData.wellnessRowsAdded || 0

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
