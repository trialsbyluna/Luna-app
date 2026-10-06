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
- Preserve the meaning of the user's wellness information.

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
- exercise should identify the activity.
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

-----------------------------------------
WORKOUT CALORIES
-----------------------------------------

Workout calorie values are estimates, not measurements.

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

-----------------------------------------
WELLNESS / DAILY CHECK-IN
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

IMPORTANT:

The following five fields are ALWAYS intended to be 1–10 scores:

- energy
- mood
- stress
- hunger
- soreness

If the user explicitly gives a number, preserve that number.

Examples:

"energy was 8"
=> energy = 8

"mood 6"
=> mood = 6

"stress was 3"
=> stress = 3

"hunger was 4"
=> hunger = 4

"soreness 2"
=> soreness = 2

-----------------------------------------
QUALITATIVE WELLNESS SCORING
-----------------------------------------

If the user gives a qualitative description instead of a number, convert it to the following fixed 1–10 scale.

Do NOT randomly choose a number.

MOOD / ENERGY:

"terrible" = 1
"very bad" = 2
"bad" = 3
"below average" = 4
"okay" = 5
"fair" = 6
"good" = 7
"very good" = 8
"great" = 9
"excellent" = 10

STRESS / HUNGER / SORENESS:

For these fields, the score represents the AMOUNT or INTENSITY.

"none" = 1
"minimal" = 2
"very mild" = 2
"mild" = 3
"low" = 3
"moderate" = 5
"medium" = 5
"high" = 7
"severe" = 9
"very severe" = 10

If the wording clearly indicates a value between these categories, choose the closest appropriate score.

Do not invent a score when the field was not mentioned.

IMPORTANT:

When a qualitative description is converted into a number, preserve the original wording in the wellness notes.

Example:

"I have mild soreness"

=> soreness = 3
=> notes should include "mild soreness"

Example:

"mood was good"

=> mood = 7
=> notes should include "mood was good"

-----------------------------------------
WATER
-----------------------------------------

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

-----------------------------------------
OTHER WELLNESS FIELDS
-----------------------------------------

Sleep is stored in hours.

Steps are stored as the actual number.

Weight should be stored in kg when the user gives weight in kg.

If a numeric wellness field is not mentioned, use 0.

If a text wellness field is not mentioned, use "".

If no wellness information exists, wellness must be [].

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
                type: "NUMBER"
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
                type: "NUMBER"
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
    // GEMINI
    // -----------------------------------------

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
    // PARSE GEMINI
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
        typeof workout.estimated_workout_calories !== "number" ||
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

      // Preserve additional workout information
      // in the existing Notes column.

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
            `Distance: ${workout.distance} km`
          );

        }

        if (workout.speed > 0) {

          detailParts.push(
            `Speed: ${workout.speed} km/h`
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
        "mood",
        "stress",
        "hunger",
        "soreness",
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

      // Water is ALWAYS liters.

      if (checkin.water > 20) {
        checkin.water =
          checkin.water / 1000;
      }

      // Keep all graphable 1–10 fields inside
      // their expected range.

      const scoreFields = [
        "energy",
        "mood",
        "stress",
        "hunger",
        "soreness"
      ];

      scoreFields.forEach(function(field) {

        if (checkin[field] < 0) {
          checkin[field] = 0;
        }

        if (checkin[field] > 10) {
          checkin[field] = 10;
        }

      });

      const textFields = [
        "cravings",
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
