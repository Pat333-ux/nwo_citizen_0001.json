module.exports = {
  apps: [
    {
      name: 'beast-api',
      script: 'npm',
      args: 'start',
      cwd: './beast',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '512M',
      env: {
        NODE_ENV: 'production',
        PORT: process.env.PORT || '3000',
        DATABASE_URL: process.env.DATABASE_URL,
        JWT_SECRET: process.env.JWT_SECRET,
        PII_KEY_HEX: process.env.PII_KEY_HEX,
        POVERTY_LEVEL_MONTHLY: process.env.POVERTY_LEVEL_MONTHLY,
        BOOTSTRAP_ADMIN_PASSWORD: process.env.BOOTSTRAP_ADMIN_PASSWORD || ''
      },
      error_file: './beast/logs/pm2-error.log',
      out_file: './beast/logs/pm2-out.log',
      merge_logs: true
    }
  ]
};
