FROM node:22-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

# next.config.ts reads BACKEND_API_URL at build time to set up the /api proxy.
ARG BACKEND_API_URL=http://api:8000
ENV BACKEND_API_URL=${BACKEND_API_URL}
RUN npm run build

USER node
EXPOSE 3000
CMD ["npm", "start"]
