/*
 * Saves a user's profile to the profile tab in Google
 * Sheets. The Apps Script calculates BMR, maintenance,
 * fat-loss calories, protein and calorie targets.
 *
 * NEW FILE: create it in GitHub at api/profile.js
 */

// Must match the words the sheet's Maintenance Cal formula checks for.
const ACTIVITY_LEVELS = [
  "Sedentary",
  "Light",
  "Moderate",
  "Active"
];

const GENDERS = [
  "Male",
  "Female",
  "Other"
];

const DIETARY_PREFERENCES = [
  "",
  "Vegetarian",
  "Non-vegetarian",
  "Eggetarian",
  "Vegan",
  "Jain",
  "Other"
];


/*
 * Returns the number, null when left empty,
 * or undefined when it's out of range.
 */
function numberInRange(value, min, max) {

  if (value === null || value === undefined || value === "") {
    return null;
  }

  const number = Number(value);

  if (!Number.isFinite(number) || number < min || number > max) {
    return undefined;
  }

  return Math.round(number * 10) / 10;

}


function shortText(value, maxLength) {
  return String(value || "").trim().slice(0, maxLength);
}


export default async function handler(req, res) {

  if (req.method !== "POST") {

    return res.status(405).json({
      success: false,
      error: "Method not allowed."
    });

  }

  try {

    const { userId, profile } = req.body || {};

    if (!userId || !String(userId).trim()) {

      return res.status(400).json({
        success: false,
        error: "User ID is required."
      });

    }

    if (!profile || typeof profile !== "object") {

      return res.status(400).json({
        success: false,
        error: "Profile details are missing."
      });

    }

    const webhookUrl = process.env.GOOGLE_SHEETS_WEBHOOK_URL;
    const secret = process.env.LUNA_SHEETS_SECRET;

    if (!webhookUrl || !secret) {

      return res.status(500).json({
        success: false,
        error: "Profile configuration is missing."
      });

    }

    const age = numberInRange(profile.age, 10, 100);
    const heightCm = numberInRange(profile.heightCm, 100, 250);
    const currentWeight = numberInRange(profile.currentWeight, 25, 300);
    const goalWeight = numberInRange(profile.goalWeight, 25, 300);
    const stepsGoal = numberInRange(profile.stepsGoal, 1000, 50000);
    const customCalorieTarget = numberInRange(profile.customCalorieTarget, 1000, 5000);

    const gender = GENDERS.includes(profile.gender) ? profile.gender : "";
    const activityLevel = ACTIVITY_LEVELS.includes(profile.activityLevel) ? profile.activityLevel : "";
    const dietaryPreference = DIETARY_PREFERENCES.includes(profile.dietaryPreference) ? profile.dietaryPreference : "";

    const email = shortText(profile.email, 120);

    const problems = [];

    if (!gender) problems.push("gender");
    if (!age) problems.push("age between 10 and 100");
    if (!heightCm) problems.push("height between 100 and 250 cm");
    if (!currentWeight) problems.push("current weight between 25 and 300 kg");
    if (goalWeight === undefined) problems.push("goal weight between 25 and 300 kg");
    if (!activityLevel) problems.push("activity level");
    if (stepsGoal === undefined) problems.push("steps goal between 1,000 and 50,000");
    if (customCalorieTarget === undefined) problems.push("custom calorie target between 1,000 and 5,000 kcal");
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) problems.push("email address");

    if (problems.length) {

      return res.status(400).json({
        success: false,
        error: "Please check: " + problems.join(", ") + "."
      });

    }

    const cleanProfile = {
      name: shortText(profile.name, 80),
      email: email,
      gender: gender,
      age: Math.round(age),
      heightCm: heightCm,
      currentWeight: currentWeight,
      goalWeight: goalWeight,
      activityLevel: activityLevel,
      dietaryPreference: dietaryPreference,
      injuries: shortText(profile.injuries, 300),
      medical: shortText(profile.medical, 300),
      stepsGoal: stepsGoal ? Math.round(stepsGoal) : 8000,
      customCalorieTarget: customCalorieTarget ? Math.round(customCalorieTarget) : null
    };

    const response = await fetch(webhookUrl, {

      method: "POST",

      headers: {
        "Content-Type": "application/json"
      },

      body: JSON.stringify({
        action: "saveProfile",
        token: secret,
        userId: String(userId).trim(),
        profile: cleanProfile
      })

    });

    const text = await response.text();

    let data;

    try {
      data = JSON.parse(text);
    } catch {

      return res.status(502).json({
        success: false,
        error: "Google Sheets returned an invalid response."
      });

    }

    if (!response.ok || !data.success) {

      return res.status(502).json({
        success: false,
        error: data.error || "Unable to save profile."
      });

    }

    return res.status(200).json(data);

  } catch (error) {

    return res.status(500).json({
      success: false,
      error: error.message || "Profile request failed."
    });

  }

}
