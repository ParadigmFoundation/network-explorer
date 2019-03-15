# using node 11
FROM node:latest
WORKDIR /usr/src/net-api

# copy source, package, and config files
COPY ./package.json ./
COPY ./yarn.lock ./
COPY ./tsconfig.json ./
COPY ./src/* ./src/

# install deps
RUN yarn global add node-gyp scrypt typescript
RUN yarn

# build source to executable js
RUN yarn build

# allow api traffic
EXPOSE 8080

# set start command
CMD [ "yarn", "start" ]