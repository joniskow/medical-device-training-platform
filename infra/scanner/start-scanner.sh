#!/bin/sh
set -eu
chown -R clamav:clamav /var/lib/clamav
freshclam --foreground --stdout --config-file=/etc/clamav/freshclam.conf
exec /init "$@"
