# Production environment

Hostname: `api.retropilot.org`

## Setup

Refer to the `environments/uat` environment for setup instructions.

## Deployment

Make sure to create and modify the `.env` file as required for your environment.

Note that the first time you run the API it will initialise the database. It is a good idea to do this once before
starting all the services together.

Before first run (in `/data/retropilot-server`):
```sh
cd environment/production

# copy and modify the `.env` file as required
cp .env.sample .env

# allow the API to initialise the database schema
docker compose up api
# CTRL-C when "RetroPilot Server listening at" message appears
```

To start all the services:
```sh
cd environment/production
docker compose up -d
```
