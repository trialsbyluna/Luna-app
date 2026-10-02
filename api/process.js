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
You are Luna, an AI health, nutrition, workout, and wellness tracking assistant.

Analyze the user's note.

The note may contain:
- FOOD
- WORKOUT
- WELLNESS
- any combination of these
- none of these

Return ONLY valid JSON.

IMPORTANT:

- Extract every explicitly mentioned food item.
- Extract every explicitly described workout set.
- Extract wellness information that is explicitly mentioned.
- Do not invent events.
- Do not invent quantities, reps, weights, sleep, water, mood, etc.
- Nutrition values may be estimated using common nutritional averages.
- Fiber should be estimated whenever reasonable.
- If a food has negligible fiber, use 0.
- Workout calories are approximate estimates, NOT exact measurements.
- Estimate workout calories when enough information exists.
- If a workout calorie estimate cannot reasonably be made, use 0.
- Do not turn food into workout information.
- Do not turn workout into food information.
- Do not turn wellness into food or workout information.

FOOD:

For every food item return:

meal_time
meal_type
food_item
quantity_grams
calories
protein
carbs
fat
fiber
notes

WORKOUT:

For every explicitly described set return:

exercise
muscle_group
set_number
reps_completed
weight_value
weight_type
set_result
duration_mins
notes
estimated_workout_calories

Example:

"I did 3 sets of squats, 10 reps each, with 40 kg"

must produce exactly 3 workout objects:

set 1
set 2
set 3

with 10 reps and 40 kg for each.

WELLNESS:

Use one object for the wellness information in the note.

Fields:

weight
water
sleep
energy
mood
stress
hunger
cravings
soreness
steps
period_day
period_flow
period_symptoms
notes

If a wellness field is not mentioned, use:
- 0 for numeric fields
- "" for text fields

If no wellness information exists, wellness must be [].

ENTRY DATE:
${today}

USER ID:
${userId || ""}

USER NOTE:
${note}
`;

    /*
     * Gemini structured output schema.
     *
     * IMPORTANT:
     * Gemini does not accept JSON Schema union types such as
     * ["number", "null"] here.
     *
     * Therefore numeric fields are plain "number" and text
     * fields are plain "string".
     */

    const responseSchema = {
      type: "OBJECT",

      properties: {

        type: {
          type: "STRING",
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
          type: "ARRAY",

          items: {
            type: "OBJECT",

            properties: {

              meal_time: {
                type: "STRING"
              },

              meal_type: {
                type: "STRING"
              },

              food_item: {
                type: "STRING"
              },

              quantity_grams: {
                type: "NUMBER"
              },

              calories: {
                type: "NUMBER"
              },

              protein: {
                type: "NUMBER"
              },

              carbs: {
                type: "NUMBER"
              },

              fat: {
                type: "NUMBER"
              },

              fiber: {
                type: "NUMBER"
              },

              notes: {
                type: "STRING"
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
          type: "ARRAY",

          items: {
            type: "OBJECT",

            properties: {

              exercise: {
                type: "STRING"
              },

              muscle_group: {
                type: "STRING"
              },

              set_number: {
                type: "NUMBER"
              },

              reps_completed: {
                type: "NUMBER"
              },

              weight_value: {
                type: "NUMBER"
              },

              weight_type: {
                type: "STRING"
              },

              set_result: {
                type: "STRING"
              },

              duration_mins: {
                type: "NUMBER"
              },

              notes: {
                type: "STRING"
              },

              estimated_workout_calories: {
                type: "NUMBER"
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
          type: "ARRAY",

          items: {
            type: "OBJECT",

            properties: {

              weight: {
                type: "NUMBER"
              },

              water: {
                type: "NUMBER"
              },

              sleep: {
                type: "NUMBER"
              },

              energy: {
                type: "NUMBER"
              },

              mood: {
                type: "STRING"
              },

              stress: {
                type: "NUMBER"
              },

              hunger: {
                type: "NUMBER"
              },

              cravings: {
                type: "STRING"
              },

              soreness: {
                type: "STRING"
              },

              steps: {
                type: "NUMBER"
              },

              period_day: {
                type: "NUMBER"
              },

              period_flow: {
                type: "STRING"
              },

              period_symptoms: {
                type: "STRING"
              },

              notes: {
                type: "STRING"
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


    // -----------------------------------------
    // GEMINI
    // -----------------------------------------

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
                  responseSchema

              }

            })
          }
        );


        data =
          await response.json();


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
              resolve =>
                setTimeout(
                  resolve,
                  delay
                )
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


      if (
        response &&
        response.ok
      ) {
        break;
      }
    }


    if (
      !response ||
      !response.ok
    ) {

      return res.status(503).json({

        error:
          "Gemini is temporarily busy. Please try again in a moment."

      });

    }


    // -----------------------------------------
    // PARSE GEMINI RESPONSE
    // -----------------------------------------

    const text =
      data
        ?.candidates?.[0]
        ?.content?.parts?.[0]
        ?.text || "";


    let result;


    try {

      result =
        JSON.parse(text);

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
    // NORMALIZE FOOD
    // -----------------------------------------

    foods.forEach(function(food) {

      if (
        typeof food.fiber !== "number" ||
        Number.isNaN(food.fiber)
      ) {

        food.fiber = 0;

      }

    });


    // -----------------------------------------
    // NORMALIZE WORKOUT
    // -----------------------------------------

    workouts.forEach(function(workout) {

      if (
        typeof workout.estimated_workout_calories
        !== "number" ||
        Number.isNaN(
          workout.estimated_workout_calories
        )
      ) {

        workout.estimated_workout_calories = 0;

      }

    });


    // -----------------------------------------
    // NORMALIZE WELLNESS
    // -----------------------------------------

    wellness.forEach(function(checkin) {

      const numericFields = [
        "weight",
        "water",
        "sleep",
        "energy",
        "stress",
        "hunger",
        "steps",
        "period_day"
      ];


      numericFields.forEach(function(field) {

        if (
          typeof checkin[field] !== "number" ||
          Number.isNaN(checkin[field])
        ) {

          checkin[field] = 0;

        }

      });


      const textFields = [
        "mood",
        "cravings",
        "soreness",
        "period_flow",
        "period_symptoms",
        "notes"
      ];


      textFields.forEach(function(field) {

        if (
          typeof checkin[field] !== "string"
        ) {

          checkin[field] = "";

        }

      });

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
          type,
          foods,
          workouts,
          wellness
        }

      });

    }


    // -----------------------------------------
    // SEND TO GOOGLE SHEETS
    // -----------------------------------------

    const sheetsResponse =
      await fetch(
        process.env.GOOGLE_SHEETS_WEBHOOK_URL,
        {
          method: "POST",

          headers: {
            "Content-Type":
              "application/json"
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
        JSON.parse(
          sheetsText
        );

    } catch {

      return res.status(500).json({

        error:
          "Google Sheets did not return valid JSON.",

        debug: {

          httpStatus:
            sheetsResponse.status,

          response:
            sheetsText.substring(
              0,
              500
            )

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


    // -----------------------------------------
    // FINAL RESPONSE
    // -----------------------------------------

    return res.status(200).json({

      success: true,

      type:

        type,

      foods:

        foods,

      workouts:

        workouts,

      wellness:

        wellness,

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
