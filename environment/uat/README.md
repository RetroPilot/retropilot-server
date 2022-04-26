# User Acceptance Testing (UAT) environment

Hostname: `uat.api.retropilot.org`

## Setup

This setup assumes you have `docker` and `docker-compose` installed on your machine, and that you have added the
relevant users to the `docker` group. Instructions given below are an example - you should look to the official
documentation [here for Docker Engine](https://docs.docker.com/engine/install/) and [here for Docker Compose](https://docs.docker.com/compose/install/).

```sh
# install docker and setup systemd to start it on boot
sudo yum install docker-ce docker-ce-cli containerd.io
sudo systemctl start docker
sudo systemctl enable docker

# add $USER to the docker group
sudo usermod -aG docker $USER

# logout and back in to see the change

# install docker compose v2 for all users
DOCKER_CONFIG=/usr/local/lib/docker
sudo mkdir -p $DOCKER_CONFIG/cli-plugins
sudo curl -SL https://github.com/docker/compose/releases/download/v2.2.3/docker-compose-linux-x86_64 -o $DOCKER_CONFIG/cli-plugins/docker-compose
sudo chmod +x $DOCKER_CONFIG/cli-plugins/docker-compose

# test docker compose
docker compose version
```

Clone the Git repo to `/data/retropilot-server`. We can clone it using the `--shared` argument to allow multiple users
to read/write these files (taking advantage of the Linux `sgid` permissions bit).

```sh
# create /data directory and relax permissions to let a non-root user write to it
sudo mkdir /data
sudo chmod a+w /data

# clone the repository
cd /data
git clone https://github.com/RetroPilot/retropilot-server.git --shared --branch uat

# allow any user in the 'docker' group to read/write the files in this directory
sudo chgrp -R docker retropilot-server

# tighten /data permissions again so that not non-root users cannot write to it
sudo chmod a-w /data
```

## Deployment

Make sure to create and modify the `.env` file as required for your environment.

Note that the first time you run the PostgreSQL container it will have to initialise.
The server and worker cannot interact with it before this happens.

Before first run (in `/data/retropilot-server`):
```sh
cd environment/uat

# copy and modify the `.env` file as required
cp .env.sample .env

# create the database
docker compose up db
# CTRL-C when "database system is ready to accept connections" message appears

# allow the API to initialise the database schema
docker compose up db api
# CTRL-C when "RetroPilot Server listening at" message appears
```

To start all the services:
```sh
cd environment/uat
docker compose up -d
```
