FROM node:22-alpine@sha256:dbcedd8aeab47fbc0f4dd4bffa55b7c3c729a707875968d467aaaea42d6225af

RUN npm install -g jazz-run@0.18.33 wscat@6.1.0

CMD ["jazz-run", "sync", "--host", "0.0.0.0", "--port", "4200", "--db", "/data/storage.db"]
