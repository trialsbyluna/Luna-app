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

    const prompt = `
You are Luna, an AI health and nutrition tracking assistant.

Analyze the user's note and identify whether it contains:
- food
- workout
- wellness information

For now, focus on FOOD information.

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

User ID:
${userId || ""}

User note:
${note}
`;

    const maxAttempts = 3;
    let response;
    let data;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      response = await fetch(
        "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent",
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

      // Successful response
      if (response.ok) {
        break;
      }

      // Retry temporary Gemini errors
      if (response.status === 503 || response.status === 429) {
        if (attempt < maxAttempts) {
          const delay = Math.pow(2, attempt - 1) * 1000;
          console.log(
            `Gemini temporary error ${response.status}. Retrying in ${delay}ms...`
          );

          await new Promise((resolve) =>
            setTimeout(resolve, delay)
          );

          continue;
        }
      }

      // Non-retryable error
      console.error("Gemini error:", data);

      return res.status(500).json({
        error: "Gemini request failed."
      });
    }

    if (!response || !response.ok) {
      console.error("Gemini failed after retries:", data);

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
    } catch (parseError) {
      console.error("JSON parsing error:", parseError);
      console.error("Gemini returned:", text);

      return res.status(500).json({
        error: "Gemini returned an unexpected response."
      });
    }

    return res.status(200).json(result);

  } catch (error) {
    console.error("Server error:", error);

    return res.status(500).json({
      error: "Something went wrong while processing your entry."
    });
  }
}
