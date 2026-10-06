export default async function handler(req, res) {

  if (req.method !== "POST") {

    return res.status(405).json({
      success: false,
      error: "Method not allowed."
    });

  }

  try {

    const { userId } = req.body || {};

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

    if (!webhookUrl || !secret) {

      return res.status(500).json({
        success: false,
        error: "Dashboard configuration is missing."
      });

    }

    const response =
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

    const text =
      await response.text();

    let data;

    try {

      data =
        JSON.parse(text);

    } catch {

      return res.status(502).json({

        success: false,

        error:
          "Google Sheets returned an invalid response."

      });

    }

    if (!response.ok || !data.success) {

      return res.status(502).json({

        success: false,

        error:
          data.error ||
          "Unable to load dashboard data."

      });

    }

    return res.status(200).json(data);

  } catch (error) {

    return res.status(500).json({

      success: false,

      error:
        error.message ||
        "Dashboard request failed."

    });

  }

}
