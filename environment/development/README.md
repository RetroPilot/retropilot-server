# Development environment

Test in docker containers on your development machine

## Usage

### Environment

Copy `.env.sample` to `.env` and edit as needed.

```
cp .env.sample .env
```

### Deployment

Note that the first time you run the PostgreSQL container it will have to initialise.
The server and worker cannot interact with it before this happens.

Before first run:
```
cd environment/development

# Create the database
docker-compose up db
# CTRL-C when "database system is ready to accept connections" message appears

# Allow the API program to initialise the database schema
docker-compose up db api
# CTRL-C when "RetroPilot Server listening at" message appears
```

To start all the services:
```
cd environment/development
docker-compose up -d
```
