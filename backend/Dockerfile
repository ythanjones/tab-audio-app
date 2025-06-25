# File: backend/Dockerfile
# This file is a blueprint that tells Google Cloud Build how to create
# the environment for our backend server.

# Use an official Node.js runtime as a parent image
FROM node:18-slim

# Set the working directory in the container
WORKDIR /usr/src/app

# Copy package.json and package-lock.json
COPY package*.json ./

# Install app dependencies
RUN npm install

# Bundle app source
COPY . .

# Your app binds to port 8080 so you need to tell Docker that
EXPOSE 8080

# Define the command to run your app
CMD [ "node", "index.js" ]