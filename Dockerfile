FROM node:14

# Create app directory
RUN mkdir -p /usr/src/app
WORKDIR /usr/src/app

# Installing dependencies
COPY package*.json /usr/src/app/
RUN yarn --frozen-lockfile

# Copying source files
COPY . /usr/src/app

EXPOSE 3000

# Running the app
CMD "yarn" "run" "start:prod"
