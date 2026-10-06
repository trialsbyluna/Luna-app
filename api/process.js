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

    // -----------------------------------------
    // EXTRACTION PROMPT
    // -----------------------------------------

    const prompt = `
You are Luna, an AI health, nutrition, workout, and wellness tracking assistant.

Analyze the user's note and extract only information that is actually present.

Return ONLY valid JSON matching the supplied schema.

GENERAL RULES:

- Extract every explicitly mentioned food item.
- Extract every explicitly described workout activity.
- Extract wellness information that is explicitly mentioned.
- Do not invent events.
- Do not invent quantities, repetitions, weights, distances, speeds, durations, sleep, water, mood, etc.
- Nutrition values may be estimated using common nutritional averages.
- Preserve useful food-specific details.
- Preserve useful workout-specific details.
- Preserve the user's wording for qualitative wellness information.
- Do not convert qualitative words such as "good", "bad", "mild", "high", or "low" into a numerical score unless the user explicitly gives a numerical score.
- If a field is not mentioned, use the appropriate empty/zero value defined by the schema.

-----------------------------------------
FOOD
-----------------------------------------

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

FOOD RULES:

1. Create ONE object per food item.

2. Preserve the specific food identity.

Examples:

"whole wheat bread" must remain "whole wheat bread".

"multigrain bread" must remain "multigrain bread".

"white bread" must remain "white bread".

Do NOT change specific bread types into generic "toast".

3. If the user says "toast" without specifying the bread type, use "toast".

4. Preserve preparation details when explicitly stated.

5. Estimate nutrition using common nutritional averages.

6. Fiber must reflect actual food characteristics.

7. Do NOT invent fiber for foods that naturally contain essentially no fiber.

For example:
- eggs have essentially 0 g dietary fiber
- meat has 0 g dietary fiber
- fish has 0 g dietary fiber

8. If no food exists, foods must be [].

-----------------------------------------
WORKOUT
-----------------------------------------

Workout activities fall into two broad categories:

A. STRENGTH / RESISTANCE
B. CARDIO

-----------------------------------------
STRENGTH / RESISTANCE
-----------------------------------------

For each explicitly described set return:

exercise
activity_type
muscle_group
set_number
reps_completed
weight_value
weight_type
weight_basis
set_result
duration_mins
distance
speed
incline
notes
estimated_workout_calories

Rules:

- Create one object per explicitly described set.
- If the user says:
  "3 sets of squats, 10 reps each at 40 kg"
  create exactly 3 objects.
- Do not invent sets.
- Do not invent reps.
- Do not invent weight.
- Do not invent duration.
- If duration is not explicitly stated, duration_mins = 0.
- Do not infer duration from sets or reps.
- If distance, speed, or incline are not relevant, use 0.
- activity_type must be "strength".

WEIGHT BASIS:

Pay close attention to wording.

Examples:

"5 kg each"
=> weight_value = 5
=> weight_type = "kg"
=> weight_basis = "each"

"5 kg per dumbbell"
=> weight_basis = "each"

"10 kg total"
=> weight_value = 10
=> weight_basis = "total"

"5 kg per side"
=> weight_value = 5
=> weight_basis = "per side"

"40 kg" with no indication whether it is total, each, or per side
=> weight_value = 40
=> weight_basis = "unknown"

NEVER guess the weight basis.

If the basis is unclear, use "unknown".

-----------------------------------------
CARDIO
-----------------------------------------

Cardio must NOT be represented as a strength set.

For cardio return one activity object unless the user explicitly describes multiple separate cardio activities.

Fields:

exercise
activity_type
muscle_group
set_number
reps_completed
weight_value
weight_type
weight_basis
set_result
duration_mins
distance
speed
incline
notes
estimated_workout_calories

CARDIO RULES:

- activity_type = "cardio".
- exercise should identify the activity, such as:
  walking
  running
  cycling
  swimming
  treadmill
  elliptical

- Capture duration ONLY when explicitly stated.

- Capture speed ONLY when explicitly stated.

- Capture distance ONLY when explicitly stated.

- Capture incline ONLY when explicitly stated.

Examples:

"walked for 30 minutes"
=> duration_mins = 30
=> speed = 0
=> distance = 0

"walked 3 km in 30 minutes"
=> distance = 3
=> duration_mins = 30

"treadmill for 20 minutes at 6 km/h"
=> duration_mins = 20
=> speed = 6
=> speed unit should be preserved in notes if necessary

"treadmill at 5% incline"
=> incline = 5

Do NOT invent speed, distance, or incline.

For cardio:
- set_number = 0
- reps_completed = 0
- weight_value = 0
- weight_type = ""
- weight_basis = "unknown"
- set_result = ""

Do not create fake sets for cardio.

-----------------------------------------
WORKOUT CALORIES
-----------------------------------------

Workout calorie values are estimates, not measurements.

Most importantly:

Do NOT randomly change the estimate for identical workout descriptions.

Use a consistent approach.

For strength workouts where duration is not explicitly provided:

- Do not pretend that the calorie number is precise.
- Use a conservative consistent estimate based on the exercise/set description.
- Identical exercise + reps + weight should produce approximately the same estimate.

For cardio:

- Estimate only when duration is explicitly provided and the activity is reasonably identifiable.
- Use the same estimation approach for the same activity and duration.
- If insufficient information exists, use 0.

Never claim workout calories are exact.

-----------------------------------------
WELLNESS
-----------------------------------------

Use one wellness object when wellness information exists.

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

WELLNESS RULES:

1. Preserve explicit numeric values.

Examples:

"energy was 8"
=> energy = 8

"stress was 3"
=> stress = 3

"hunger was 4"
=> hunger = 4

2. Do NOT convert qualitative descriptions into numbers.

Example:

"mood was good"
=> mood = "good"

NOT:
mood = 8

Example:

"I have mild soreness"
=> soreness = "mild soreness"

NOT:
soreness = 3

3. Preserve qualitative information as text.

4. WATER:

Normalize water to LITERS.

Examples:

"2 L"
=> water = 2

"2 liters"
=> water = 2

"500 ml"
=> water = 0.5

"750 ml"
=> water = 0.75

"1500 ml"
=> water = 1.5

Never store milliliters in the water field.

5. Sleep is stored in hours.

Example:

"7.5 hours"
=> sleep = 7.5

6. Steps should be stored as the actual number.

Example:

"6000 steps"
=> steps = 6000

7. If a numeric wellness field is not mentioned, use 0.

8. If a text wellness field is not mentioned, use "".

9. If no wellness information exists, wellness must be [].

-----------------------------------------
ENTRY DATE
-----------------------------------------

${today}

USER ID:

${userId || ""}

-----------------------------------------
USER NOTE
-----------------------------------------

${note}
`;

    // -----------------------------------------
    // RESPONSE SCHEMA
    // -----------------------------------------

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

              activity_type: {
                type: "STRING",
                enum: [
                  "strength",
                  "cardio"
                ]
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

              weight_basis: {
                type: "STRING",
                enum: [
                  "each",
                  "total",
                  "per side",
                  "unknown"
                ]
              },

              set_result: {
                type: "STRING"
              },

              duration_mins: {
                type: "NUMBER"
              },

              distance: {
                type: "NUMBER"
              },

              speed: {
                type: "NUMBER"
              },

              incline: {
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
              "activity_type",
              "muscle_group",
              "set_number",
              "reps_completed",
              "weight_value",
              "weight_type",
              "weight_basis",
              "set_result",
              "duration_mins",
              "distance",
              "speed",
              "incline",
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

    // -----------------------------------------
    // GEMINI MODELS
    // -----------------------------------------

    const models = [
      "gemini-3.8-flash",
      "gemini-3.5-flash-lite"
    ];

    let response = null;
    let data = null;

    // -----------------------------------------
    // GEMINI REQUEST
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

      if (
        typeof food.quantity_grams !== "number" ||
        Number.isNaN(food.quantity_grams)
      ) {

        food.quantity_grams = 0;

      }

      if (
        typeof food.notes !== "string"
      ) {

        food.notes = "";

      }

    });

    // -----------------------------------------
    // NORMALIZE WORKOUT
    // -----------------------------------------

    workouts.forEach(function(workout) {

      if (
        typeof workout.duration_mins !== "number" ||
        Number.isNaN(workout.duration_mins)
      ) {

        workout.duration_mins = 0;

      }

      if (
        typeof workout.distance !== "number" ||
        Number.isNaN(workout.distance)
      ) {

        workout.distance = 0;

      }

      if (
        typeof workout.speed !== "number" ||
        Number.isNaN(workout.speed)
      ) {

        workout.speed = 0;

      }

      if (
        typeof workout.incline !== "number" ||
        Number.isNaN(workout.incline)
      ) {

        workout.incline = 0;

      }

      if (
        typeof workout.estimated_workout_calories
        !== "number" ||
        Number.isNaN(
          workout.estimated_workout_calories
        )
      ) {

        workout.estimated_workout_calories = 0;

      }

      if (
        ![
          "each",
          "total",
          "per side",
          "unknown"
        ].includes(workout.weight_basis)
      ) {

        workout.weight_basis = "unknown";

      }

      if (
        workout.activity_type !== "cardio"
      ) {

        workout.activity_type = "strength";

      }

      // Preserve the new workout details inside
      // the existing Notes column without changing
      // the Google Sheet structure.

      const detailParts = [];

      if (
        workout.weight_basis &&
        workout.weight_basis !== "unknown"
      ) {

        detailParts.push(
          `Weight basis: ${workout.weight_basis}`
        );

      }

      if (
        workout.activity_type === "cardio"
      ) {

        if (workout.distance > 0) {

          detailParts.push(
            `Distance: ${workout.distance}`
          );

        }

        if (workout.speed > 0) {

          detailParts.push(
            `Speed: ${workout.speed}`
          );

        }

        if (workout.incline > 0) {

          detailParts.push(
            `Incline: ${workout.incline}%`
          );

        }

      }

      if (detailParts.length > 0) {

        const generatedDetails =
          detailParts.join(" | ");

        if (workout.notes) {

          workout.notes =
            `${workout.notes} | ${generatedDetails}`;

        } else {

          workout.notes =
            generatedDetails;

        }

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

      // Safety normalization:
      // water is ALWAYS stored in liters.
      //
      // If the model somehow returns a large
      // milliliter-style number, convert it.
      //
      // Example:
      // 500 -> 0.5
      // 1000 -> 1
      // 1500 -> 1.5

      if (checkin.water > 20) {

        checkin.water =
          checkin.water / 1000;

      }

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

    // -----------------------------------------
    // LOG EXTRACTION
    // -----------------------------------------

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
