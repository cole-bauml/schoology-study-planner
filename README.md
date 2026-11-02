# Schoology Study Planner

A single-user Schoology study planner. It connects to Schoology with your API
consumer key and secret, collects your courses, sections, assignments, course materials,
and Schoology's upcoming feed, then uses the OpenAI chat-completions
API to identify dated work, syllabus information, and estimated effort.

## Requirements

- Node.js 20+
- MongoDB
- Schoology API consumer key and secret from [Schoology's API page](https://dublin.schoology.com/api)
- An OpenAI API key for course-material analysis

## Run locally

1. Copy `.env.example` to `.env` and set `APP_ENCRYPTION_KEY` and
   `SESSION_SECRET` to independent, random secrets. Keep `.env` private.
2. Set `MONGODB_URI` to your MongoDB connection string.
3. Install dependencies with `npm install`.
4. Start the app with `npm run dev`.
5. Open `http://localhost:5173` and complete the first-run setup.

The first-run form stores the Schoology credentials, OpenAI key, and app
password encrypted/hashed in MongoDB. The app password is required once per
browser; the session cookie is HTTP-only and lasts 180 days. Use Settings to
change credentials or reset the app password.

## Production

Set the environment variables above, run `npm run build`, then `npm start`.
The Express server serves the built React app and API from the same origin.
Use HTTPS in production; secure cookies are enabled when `NODE_ENV=production`.

## Notes

- Schoology credentials and the OpenAI key are encrypted at rest using
  `APP_ENCRYPTION_KEY`; losing that key makes the stored credentials
  unrecoverable.
- Course and assignment data are stored in MongoDB as the latest sync snapshot.
- The LLM is instructed to treat course content as untrusted source material
  and only extract evidence-backed dates and workload information.
- API availability and accessible course content depend on the permissions
  granted to your Schoology API credentials.
