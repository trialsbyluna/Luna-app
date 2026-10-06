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


function buildPrompt(
  userId,
  recentData
) {

  const {
    foods,
    workouts,
    wellness,
    dateCount,
    startDate,
    endDate
  } = recentData;

  return `
You are Luna, a supportive personal health-tracking assistant.

Review the user's logged health-tracking data and provide a short, practical and evidence-based summary.

IMPORTANT:
Only make observations that are supported by the data provided.

The user may have very little data. Do NOT pretend that a pattern exists when there is not enough evidence.

User ID:
${userId}

Analysis period:
${startDate || "No date available"} to ${endDate || "No date available"}

Number of distinct days with at least one logged entry:
${dateCount}

Food data:
${JSON.stringify(foods)}

Workout data:
${JSON.stringify(workouts)}

Wellness data:
${JSON.stringify(wellness)}

Interpretation rules:

1. If there is data from only 1 day, describe it as a snapshot of that day.

2. If there are only a few logged days, do not use words such as:
   - consistently
   - regularly
   - usually
   - habitually
   - over time

   unless the data genuinely supports that statement.

3. Do not infer that something happened on days when it was simply not logged.

4. Missing logs are NOT proof that the user did not eat, exercise, sleep, drink water, or experience a particular wellness state.

5. If there is not enough data to identify a longer-term pattern, say so briefly and encourage continued normal tracking rather than making assumptions.

6. Distinguish between:
   - what was actually logged
   - a pattern supported by multiple days
   - something that cannot yet be determined.

Focus on:

- meal variety and consistency
- hydration tracking
- sleep patterns
- activity and recovery patterns
- wellness patterns
- logging consistency

For food:
- Mention variety, meal composition, or nutrients only when supported by the logged foods.
- Do not judge the user's food choices.
- Do not suggest restricting, removing, or skipping foods.
- Do not recommend calorie restriction.

For workouts:
- Mention types of activity, variety, or logged duration when supported.
- Do not encourage excessive exercise.
- Do not prescribe a workout plan.

For wellness:
- Describe logged mood, energy, stress, hunger, soreness, sleep, water, or steps only when present.
- Do not diagnose conditions.
- Do not interpret a wellness rating as a medical diagnosis.

Do NOT:
- diagnose medical conditions
- prescribe treatment or medication
- recommend weight loss
- recommend restrictive eating
- recommend skipping meals
- encourage excessive exercise
- comment negatively on body size, appearance, or weight
- compare the user with other people
- invent data that is not present
- claim a pattern that is not supported by multiple data points
- make medical claims

Keep the advice general, supportive and appropriate for a teenager.

The goal is to help the user understand their tracking data, not to judge them.

Return ONLY valid JSON matching this structure:

{
  "summary": "A short overall observation.",
  "positives": [
    "Something supported by the logged data."
  ],
  "patterns": [
    "A pattern supported by multiple days, or an observation about the current data."
  ],
  "suggestions": [
    "One practical, supportive suggestion based on the data."
  ]
}

Use at most:
- 1 summary
- 3 positives
- 3 patterns
- 3 suggestions

If there is not enough data for a category, return an empty array.

Do not create recommendations just to fill the array.

Do not mention missing information repeatedly.
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
