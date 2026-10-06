// Frontend ↔ backend connection settings.
//
// Leave API_BASE_URL empty ('') to call the backend on the SAME origin that
// served this page. This is correct for:
//   - local dev: `node server.js`, then open http://localhost:5000
//   - the normal Render deployment (see /render.yaml): one web service
//     serves both the API and this frontend folder, so they're always on
//     the same origin and there's nothing to configure here.
//
// Only set API_BASE_URL if the frontend is hosted on a DIFFERENT origin
// than the backend (e.g. this file deployed to its own static host, or a
// separate Render Static Site). Example:
//   window.APP_CONFIG = { API_BASE_URL: 'https://taskflow-api.onrender.com' };
// If you do this, also set CORS_ORIGIN on the backend to this frontend's
// exact URL (see backend/.env.example) — otherwise the browser will block
// the requests.
window.APP_CONFIG = {
  API_BASE_URL: 'https://taskflow-web-3.onrender.com'
};
