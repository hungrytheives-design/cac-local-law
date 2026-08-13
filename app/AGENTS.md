# Expo: this project is PINNED to SDK 54

Read the exact versioned docs at https://docs.expo.dev/versions/v54.0.0/ before
writing any code.

**Do not upgrade.** `create-expo-app` scaffolds SDK 57, but the App Store build of
Expo Go only supports SDK 54, and Expo Go on both team phones is how this project
is demoed and tested. This project was deliberately pinned back to 54.

- Do NOT run `expo install expo@latest` or `npx expo upgrade`.
- Do NOT follow v57 docs. API names and defaults differ; code written against v57
  will fail at runtime in Expo Go.
- If a docs page you land on does not say v54 in the URL, change the URL.

We are not using EAS or cloud builds. Collaboration is git. See
`../plans/blueprint.md`.
