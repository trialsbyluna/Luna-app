const GEMINI_MODEL = "gemini-3.8-flash";
const GEMINI_FALLBACK_MODEL = "gemini-3.5-flash-lite";


function getDateKey(value) {

  if (!value) {
    return null;
  }

  const text =
    String(value).trim();

  const match =
    text.match(/^(\d{4}-\d{2}-\d{2})/);

  if (match) {
    return match[1];
  }

  const date =
    new Date(text);

  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date.toISOString().slice(0, 10);

}


function getRecentData(
  foods,
  workouts,
  wellness
) {

  const allRows = [
    ...(foods || []),
    ...(workouts || []),
    ...(wellness || [])
  ];

  const dates = allRows
    .map(row => getDateKey(row?.Date || row?.date))
    .filter(Boolean)
    .sort();

  if (!dates.length) {

    return {
      foods: [],
      workouts: [],
      wellness: [],
      dateCount: 0,
      startDate: null,
      endDate: null
    };

  }

  const endDate =
    new Date(
      `${dates[dates.length - 1]}T00:00:00`
    );

  const startDate =
    new Date(endDate);

  startDate.setDate(
    startDate.getDate() - 29
  );

  const startKey =
    startDate
      .toISOString()
      .slice(0, 10);

  const endKey =
    endDate
      .toISOString()
      .slice(0, 10);

  function filterRows(rows) {

    return (rows || []).filter(row => {

      const date =
        getDateKey(
          row?.Date || row?.date
        );

      if (!date) {
        return false;
      }

      return (
        date >= startKey &&
        date <= endKey
      );

    });

  }

  const recentFoods =
    filterRows(foods);

  const recentWorkouts =
    filterRows(workouts);

  const recentWellness =
    filterRows(wellness);

  const recentDates =
    new Set([
      ...recentFoods.map(
        row =>
          getDateKey(
            row?.Date || row?.date
          )
      ),
      ...recentWorkouts.map(
        row =>
          getDateKey(
            row?.Date || row?.date
          )
      ),
      ...recentWellness.map(
        row =>
          getDateKey(
            row?.Date || row?.date
          )
      )
    ]);

  recentDates.delete(null);

  return {

    foods:
      recentFoods,

    workouts:
      recentWorkouts,

    wellness:
      recentWellness,

    dateCount:
      recentDates.size,

    startDate:
      startKey,

    endDate:
      endKey

  };

}


function toNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(String(value).replace(/,/g, "").replace(/[^\d.-]/g, ""));
  return Number.isFinite(number) ? number : null;
}

function calculateMetrics(recentData) {
  const { foods, workouts, wellness, dateCount } = recentData;
  const sumField = (rows, fields) => rows.reduce((total, row) => {
    for (const field of fields) {
      const value = toNumber(row?.[field]);
      if (value !== null) return total + value;
    }
    return total;
  }, 0);
  const foodDays = new Set(foods.map(r => getDateKey(r?.Date || r?.date)).filter(Boolean));
  const workoutDays = new Set(workouts.map(r => getDateKey(r?.Date || r?.date)).filter(Boolean));
  const wellnessDays = new Set(wellness.map(r => getDateKey(r?.Date || r?.date)).filter(Boolean));
  return {
    dateCount,
    calories: Math.round(sumField(foods, ["Calories", "calories"])),
    protein: Math.round(sumField(foods, ["Protein", "protein"]) * 10) / 10,
    carbs: Math.round(sumField(foods, ["Carbs", "carbs"]) * 10) / 10,
    fat: Math.round(sumField(foods, ["Fat", "fat"]) * 10) / 10,
    fiber: Math.round(sumField(foods, ["Fiber", "fiber"]) * 10) / 10,
    water: Math.round(sumField(wellness, ["Water", "water"]) * 100) / 100,
    sleep: Math.round(sumField(wellness, ["Sleep Hours", "sleep_hours", "Sleep"]) * 10) / 10,
    steps: Math.round(sumField(wellness, ["Steps", "steps"])),
    workoutMinutes: Math.round(sumField(workouts, ["Duration Mins", "duration_mins", "Duration", "duration"])),
    workoutCalories: Math.round(sumField(workouts, ["Estimated Workout Calories", "estimated_workout_calories"])),
    foodDays: foodDays.size,
    workoutDays: workoutDays.size,
    wellnessDays: wellnessDays.size
  };
}

function buildPrompt(userId, recentData) {
  const { foods, workouts, wellness, dateCount, startDate, endDate } = recentData;
  const metrics = calculateMetrics(recentData);
  return `
You are Luna, a supportive personal health-tracking assistant.

Help the user understand what stands out in their LOGGED data. Use the calculated metrics below as the primary numeric source. Do not invent targets or compare the user with other people.

User ID: ${userId}
Analysis period: ${startDate || "No date available"} to ${endDate || "No date available"}
Distinct days with any logged data: ${dateCount}

CALCULATED LOGGED METRICS
Nutrition: calories ${metrics.calories} kcal; protein ${metrics.protein} g; carbs ${metrics.carbs} g; fat ${metrics.fat} g; fiber ${metrics.fiber} g; food-log days ${metrics.foodDays}
Hydration: water logged ${metrics.water} L; wellness-log days ${metrics.wellnessDays}
Sleep: ${metrics.sleep} hours logged
Activity: workout time ${metrics.workoutMinutes} minutes; estimated workout calories ${metrics.workoutCalories} kcal; workout days ${metrics.workoutDays}; steps ${metrics.steps}

Raw food data:
${JSON.stringify(foods)}

Raw workout data:
${JSON.stringify(workouts)}

Raw wellness data:
${JSON.stringify(wellness)}

RULES
- These are logged amounts, not necessarily the user's complete real-world intake or activity.
- If something was not logged, do not say the user did not do it.
- Do not call protein, carbs, calories, fat, fiber, water, sleep, or any other quantity "too low" or "too high" unless the user has explicitly supplied a personal target. No personal targets are currently provided.
- You may state exact logged amounts and say what is represented in the log.
- You may describe useful composition observations such as protein-containing foods, vegetables/fiber-containing foods, or a mix of strength and cardio activity.
- Workout calories must be described as estimates.
- If there is only one day, describe it as a snapshot, not a long-term pattern.
- With multiple days, call something a pattern only when supported by the data.
- Do not diagnose conditions, prescribe treatment or medication, recommend weight loss or calorie restriction, recommend restrictive eating or skipping meals, encourage excessive exercise, or comment negatively on body size, appearance, or weight.
- Keep advice general, supportive and appropriate for a teenager.

WHAT TO PRIORITIZE
Nutrition: actual logged totals and what types of foods/nutrients are represented, without inventing ideal targets.
Hydration: the amount currently logged; if it is small, describe it as a small amount currently logged rather than declaring hydration objectively low.
Sleep: the logged amount and supported multi-day trends.
Activity: logged workout types, duration, and estimated calories.
Wellness: logged mood, energy, stress, hunger, soreness, sleep, water and steps.
Logging: which categories are represented across the available days.

Return ONLY valid JSON matching this structure:
{
  "summary": "A short overall observation based on the logged data.",
  "positives": ["A concrete thing represented positively in the logged data."],
  "patterns": ["A concrete data-driven observation; for one day, this can be a notable snapshot."],
  "suggestions": ["A practical, supportive suggestion based on the logged data."]
}

Use at most 1 summary, 3 positives, 3 patterns, and 3 suggestions. Prefer specific observations over generic encouragement.

Example: with 0.5 L logged, say "0.5 L of water is currently logged today; continue logging water so the dashboard reflects the rest of the day." Do NOT say "Your hydration is too low."
Example: with 37 g protein logged, say "Protein sources including eggs and dal are represented in today's food log." Do NOT say "Your protein intake is too low."

If there is not enough data for a category, return an empty array.
`;
}

async function callGemini(
  model,
  prompt
) {

  const apiKey =
    process.env.GEMINI_API_KEY;

  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  const response =
    await fetch(
      url,
      {

        method: "POST",

        headers: {
          "Content-Type":
            "application/json"
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

            responseSchema: {

              type: "OBJECT",

              properties: {

                summary: {
                  type: "STRING"
                },

                positives: {

                  type: "ARRAY",

                  items: {
                    type: "STRING"
                  }

                },

                patterns: {

                  type: "ARRAY",

                  items: {
                    type: "STRING"
                  }

                },

                suggestions: {

                  type: "ARRAY",

                  items: {
                    type: "STRING"
                  }

                }

              },

              required: [
                "summary",
                "positives",
                "patterns",
                "suggestions"
              ]

            }

          }

        })

      }
    );

  const text =
    await response.text();

  let data;

  try {

    data =
      JSON.parse(text);

  } catch {

    throw new Error(
      "Gemini returned an invalid response."
    );

  }

  if (!response.ok) {

    const error =
      data?.error?.message ||
      "Gemini request failed.";

    const apiError =
      new Error(error);

    apiError.status =
      response.status;

    throw apiError;

  }

  const output =
    data
      ?.candidates?.[0]
      ?.content?.parts?.[0]
      ?.text;

  if (!output) {

    throw new Error(
      "Gemini returned no recommendation."
    );

  }

  try {

    return JSON.parse(output);

  } catch {

    throw new Error(
      "Gemini returned invalid recommendation JSON."
    );

  }

}


export default async function handler(
  req,
  res
) {

  if (req.method !== "POST") {

    return res.status(405).json({

      success: false,

      error:
        "Method not allowed."

    });

  }

  try {

    const {
      userId
    } =
      req.body || {};

    if (!userId) {

      return res.status(400).json({

        success: false,

        error:
          "User ID is required."

      });

    }

    const webhookUrl =
      process.env
        .GOOGLE_SHEETS_WEBHOOK_URL;

    const secret =
      process.env
        .LUNA_SHEETS_SECRET;

    const geminiKey =
      process.env
        .GEMINI_API_KEY;

    if (
      !webhookUrl ||
      !secret ||
      !geminiKey
    ) {

      return res.status(500).json({

        success: false,

        error:
          "Recommendation configuration is missing."

      });

    }

    /*
     * Get the user's existing Luna data.
     */

    const dashboardResponse =
      await fetch(
        webhookUrl,
        {

          method: "POST",

          headers: {

            "Content-Type":
              "application/json"

          },

          body: JSON.stringify({

            action:
              "dashboard",

            token:
              secret,

            userId:
              userId

          })

        }
      );

    const dashboardText =
      await dashboardResponse.text();

    let dashboard;

    try {

      dashboard =
        JSON.parse(
          dashboardText
        );

    } catch {

      return res.status(502).json({

        success: false,

        error:
          "Google Sheets returned an invalid response."

      });

    }

    if (
      !dashboardResponse.ok ||
      !dashboard.success
    ) {

      return res.status(502).json({

        success: false,

        error:
          dashboard.error ||
          "Unable to load health data."

      });

    }

    /*
     * Limit analysis to the most recent
     * 30 days represented in the user's data.
     */

    const recentData =
      getRecentData(

        dashboard.foods || [],

        dashboard.workouts || [],

        dashboard.wellness || []

      );

    /*
     * Ask Gemini to interpret the data.
     */

    const prompt =
      buildPrompt(
        userId,
        recentData
      );

    let recommendations;

    try {

      recommendations =
        await callGemini(
          GEMINI_MODEL,
          prompt
        );

    } catch (error) {

      /*
       * Gemini can occasionally return a
       * temporary high-demand / unavailable
       * response, so try the fallback model.
       */

      if (
        error.status === 429 ||
        error.status === 500 ||
        error.status === 503
      ) {

        recommendations =
          await callGemini(
            GEMINI_FALLBACK_MODEL,
            prompt
          );

      } else {

        throw error;

      }

    }

    return res.status(200).json({

      success: true,

      userId:
        userId,

      recommendations:
        recommendations

    });

  } catch (error) {

    console.error(
      "Recommendation error:",
      error
    );

    return res.status(500).json({

      success: false,

      error:
        error.message ||
        "Unable to generate recommendations."

    });

  }

}
