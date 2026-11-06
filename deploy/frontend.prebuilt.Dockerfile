# Build context contains only frontend-dist/, nginx.conf and docker-entrypoint.sh.
# Vue compilation happens on the development machine. nginx remains native ARM64.
FROM nginx:1.27-alpine

LABEL org.opencontainers.image.source="https://github.com/RaydenDodd/personal-finance-dashboard"

RUN apk add --no-cache gettext \
    && mkdir -p /app /landing /etc/nginx/includes /etc/nginx/http-includes /etc/nginx/templates \
    && touch /etc/nginx/nginx.conf \
    && chown nginx:nginx /app /landing /etc/nginx/includes /etc/nginx/http-includes /etc/nginx/nginx.conf

COPY --chown=nginx:nginx frontend-dist/ /app/
COPY --chown=nginx:nginx nginx.conf /etc/nginx/templates/nginx.conf.template
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod 755 /usr/local/bin/docker-entrypoint.sh

USER nginx
EXPOSE 8080
ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
CMD ["nginx", "-g", "daemon off;"]
