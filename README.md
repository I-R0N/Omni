<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/drive/1yGJKP-2hozdrONwajxoznMCj4NxNK7Fk

## Run Locally

**Prerequisites:**  Node.js


1. Install dependencies:
   `npm install`
2. Set the `GEMINI_API_KEY` in [.env.local](.env.local) to your Gemini API key
3. Run the app:
   `npm run dev`

## Deploying to Firebase Hosting

1. Install Firebase CLI: `npm install -g firebase-tools`
2. Log in: `firebase login`
3. Set your project id in `.firebaserc` (replace `your-firebase-project-id`)
4. Build the app: `npm run build` (outputs to `dist`)
5. Deploy: `firebase deploy --only hosting`

You can also test locally with `firebase serve --only hosting`. The included `firebase.json` serves the built `dist` folder with clean URLs.

## Deploying to Netlify

1. Use the CLI via npx (no install needed): `npx netlify-cli login`
2. Optional: `npx netlify-cli init` to link the repo (or use the Netlify UI and connect the Git repo).
3. Build locally: `npm run build`
4. Deploy: `npx netlify-cli deploy --prod --dir=dist`

The included `netlify.toml` already sets the build command (`npm run build`) and publish directory (`dist`). In the Netlify UI, set Build command = `npm run build` and Publish directory = `dist`. For dev preview, `npx netlify-cli dev` will proxy Vite (configured on port 8888).
