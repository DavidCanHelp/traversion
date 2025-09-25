import express from 'express';
import swaggerUi from 'swagger-ui-express';
import YAML from 'yamljs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const port = process.env.DOCS_PORT || 3336;

// Load the OpenAPI specification
const swaggerDocument = YAML.load(join(__dirname, '../../swagger.yaml'));

// Swagger UI options
const options = {
  customCss: `
    .swagger-ui .topbar { display: none }
    .swagger-ui .info .title { color: #2c3e50; }
    .swagger-ui .info .description { font-size: 16px; }
    .swagger-ui .scheme-container { background: #f8f9fa; padding: 15px; border-radius: 5px; }
  `,
  customSiteTitle: "Traversion API Documentation",
  customfavIcon: "/favicon.ico",
  swaggerOptions: {
    persistAuthorization: true,
    displayRequestDuration: true,
    docExpansion: 'list',
    filter: true,
    showRequestHeaders: true,
    tryItOutEnabled: true
  }
};

// Serve Swagger documentation
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerDocument, options));

// Health check for docs server
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    service: 'traversion-docs',
    timestamp: new Date().toISOString()
  });
});

// Redirect root to docs
app.get('/', (req, res) => {
  res.redirect('/api-docs');
});

app.listen(port, () => {
  console.log(`
╔════════════════════════════════════════╗
║     Traversion API Documentation       ║
╠════════════════════════════════════════╣
║  Documentation: http://localhost:${port}    ║
║  Swagger UI:    http://localhost:${port}/api-docs ║
║  Health Check:  http://localhost:${port}/health    ║
╚════════════════════════════════════════╝
  `);
});

export default app;