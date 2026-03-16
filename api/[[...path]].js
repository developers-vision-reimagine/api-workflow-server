/**
 * Vercel serverless catch-all: forwards all /api/* requests to the Express app.
 */
import app from '../server.js';

export const config = {
  maxDuration: 300,
};

export default function handler(req, res) {
  return app(req, res);
}
