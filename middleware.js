import dotenv from 'dotenv';

// Load biến môi trường từ file .env
dotenv.config();

// Middleware kiểm tra x-api-key
export function apiKeyAuth(req, res, next) {
  const apiKey = req.headers['x-api-key'];
  const expectedApiKey = process.env.X_API_KEY;

  if (!apiKey || apiKey !== expectedApiKey) {
    return res.status(401).json({ success: false, error: 'Invalid or missing x-api-key' });
  }

  next();
}

// Middleware kiểm tra Basic Authentication
export function basicAuth(req, res, next) {
  if (req.session.isAuthenticated) {
    return next();
  }
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Basic ')) {
    res.setHeader('WWW-Authenticate', 'Basic realm="Zalo Bot Admin"');
    return res.status(401).send('Authentication required');
  }
  const base64Credentials = authHeader.split(' ')[1];
  const credentials = Buffer.from(base64Credentials, 'base64').toString('ascii');
  const [username, password] = credentials.split(':');
  const expectedUsername = process.env.ADMIN_USERNAME;
  const expectedPassword = process.env.ADMIN_PASSWORD;
  if (username === expectedUsername && password === expectedPassword) {
    req.session.isAuthenticated = true;
    return next();
  }
  res.setHeader('WWW-Authenticate', 'Basic realm="Zalo Bot Admin"');
  return res.status(401).send('Invalid credentials');
}