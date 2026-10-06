const GEMINI_MODEL = "gemini-3.8-flash";
const GEMINI_FALLBACK_MODEL = "gemini-3.5-flash-lite";

function buildPrompt(userId, dashboard) {

  return `
You are Luna, a supportive personal health-tracking assistant.

Review the user's logged data and provide a short, practical summary of patterns in their tracking.

User ID:
${userId}

Food data:
${JSON.stringify(dashboard.foods || [])}

Workout data:
${JSON.stringify(dashboard.workouts || [])}

Wellness data:
${JSON.stringify(dashboard.wellness || [])}

Give observations based ONLY on the data provided.

Focus on:
- meal variety and consistency
- hydration tracking
- sleep patterns
- activity and recovery patterns
- wellness patterns
- consistency of logging

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

Keep the advice general, supportive and appropriate for a teenager.

Return ONLY valid JSON matching this structure:

{
  "summary": "A short overall observation.",
  "positives": [
    "Something the user is doing well."
  ],
  "patterns": [
    "A useful pattern noticed in the data."
  ],
  "suggestions": [
    "One practical suggestion based on the data."
  ]
}

Use at most:
- 1 summary
- 3 positives
- 3 patterns
- 3 suggestions

If there is not enough data for a category, return an empty array.

Do not mention missing information unnecessarily.
`;
}

async function callGemini(model, prompt) {

  const apiKey =
    process.env.GEMINI_API_KEY;

  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  const response =
    await fetch(url, {

      method: "POST",

      headers: {
        "Content-Type": "application/json"
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

    });

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
    data?.candidates?.[0]?.content?.parts?.[0]?.text;

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

export default async function handler(req, res) {

  if (req.method !== "POST") {

    return res.status(405).json({
      success: false,
      error: "Method not allowed."
    });

  }

  try {

    const {
      userId
    } = req.body || {};

    if (!userId) {

      return res.status(400).json({
        success: false,
        error: "User ID is required."
      });

    }

    const webhookUrl =
      process.env.GOOGLE_SHEETS_WEBHOOK_URL;

    const secret =
      process.env.LUNA_SHEETS_SECRET;

    const geminiKey =
      process.env.GEMINI_API_KEY;

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
      await fetch(webhookUrl, {

        method: "POST",

        headers: {
          "Content-Type": "application/json"
        },

        body: JSON.stringify({

          action: "dashboard",

          token: secret,

          userId: userId

        })

      });

    const dashboardText =
      await dashboardResponse.text();

    let dashboard;

    try {

      dashboard =
        JSON.parse(dashboardText);

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
     * Ask Gemini to interpret the existing data.
     */
    const prompt =
      buildPrompt(
        userId,
        dashboard
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

      userId: userId,

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
