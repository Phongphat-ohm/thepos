FROM postgres:16
RUN apt-get update && apt-get install -y --no-install-recommends gnupg && rm -rf /var/lib/apt/lists/*
COPY pg-uri.sh /usr/local/lib/thepos-pg-uri.sh
COPY backup.sh restore.sh schedule.sh /usr/local/bin/
RUN sed -i 's/\r$//' /usr/local/lib/thepos-pg-uri.sh /usr/local/bin/backup.sh /usr/local/bin/restore.sh /usr/local/bin/schedule.sh \
    && chmod 644 /usr/local/lib/thepos-pg-uri.sh \
    && chmod 755 /usr/local/bin/backup.sh /usr/local/bin/restore.sh /usr/local/bin/schedule.sh \
    && mkdir -p /backups && chown postgres:postgres /backups
USER postgres
ENTRYPOINT ["schedule.sh"]
