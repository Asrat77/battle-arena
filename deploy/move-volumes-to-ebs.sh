#!/bin/bash
# Moves every Docker volume on the server (both apps' data, kamal-proxy's
# config, the builder cache) onto the separate EBS data volume from
# deploy/terraform/data_volume.tf, then bind-mounts it back at
# /var/lib/docker/volumes, so containers, Kamal and the backup scripts keep
# the same paths. Run once, from the Mac, after `terraform apply` created and
# attached the volume:
#
#   VOL=$(terraform -chdir=deploy/terraform output -raw data_volume_id)
#   ssh -i ~/.ssh/battle-arena ubuntu@34.252.38.138 "sudo bash -s $VOL" < deploy/move-volumes-to-ebs.sh
#
# Docker is stopped for the final copy: both apps are down for about a minute.
# The old copy stays at /var/lib/docker/volumes.pre-ebs until you delete it.
# Safe to run again: it stops if the move is already done.
set -euo pipefail
vol=${1:?usage: move-volumes-to-ebs.sh vol-0123456789abcdef0}
dev=/dev/disk/by-id/nvme-Amazon_Elastic_Block_Store_${vol//-/}
src=/var/lib/docker/volumes

[ -e "$dev" ] || { echo "No $dev. Is $vol attached to this instance?" >&2; exit 1; }
if mountpoint -q "$src"; then echo "Already done: $src is a mount."; exit 0; fi
[ -e "$src.pre-ebs" ] && { echo "$src.pre-ebs exists from an earlier run. Look before going on." >&2; exit 1; }

if ! blkid "$dev" >/dev/null 2>&1; then
  echo "Formatting $vol (new, empty volume)."
  mkfs.ext4 -q -L arena-data "$dev"
fi
mkdir -p /data
grep -q '^LABEL=arena-data ' /etc/fstab ||
  echo 'LABEL=arena-data /data ext4 defaults,nofail 0 2' >> /etc/fstab
systemctl daemon-reload
mountpoint -q /data || mount /data
mkdir -p /data/docker-volumes

echo "Current volumes:"; du -sh "$src"/* 2>/dev/null | sort -h | tail -20
df -h /data
echo "First copy, with everything still running..."
rsync -aHAX --numeric-ids --delete "$src/" /data/docker-volumes/

restore() {
  echo "FAILED. Putting the old volumes back and starting Docker." >&2
  mountpoint -q "$src" && umount "$src"
  if [ -d "$src.pre-ebs" ]; then rmdir "$src" 2>/dev/null || true; mv "$src.pre-ebs" "$src"; fi
  sed -i '\| /var/lib/docker/volumes |d' /etc/fstab
  rm -f /etc/systemd/system/docker.service.d/data-volume.conf
  systemctl daemon-reload
  systemctl start docker
}

echo "Stopping Docker. Both apps are down until it starts again."
systemctl stop docker.socket docker.service
trap restore ERR
rsync -aHAX --numeric-ids --delete "$src/" /data/docker-volumes/
mv "$src" "$src.pre-ebs"
mkdir "$src"
grep -q ' /var/lib/docker/volumes ' /etc/fstab ||
  echo '/data/docker-volumes /var/lib/docker/volumes none bind,nofail,x-systemd.requires-mounts-for=/data 0 0' >> /etc/fstab
# Never start Docker without the data volume mounted: the apps would come up
# on empty volumes (a blank database) instead of failing visibly.
mkdir -p /etc/systemd/system/docker.service.d
printf '[Unit]\nRequiresMountsFor=/var/lib/docker/volumes\n' \
  > /etc/systemd/system/docker.service.d/data-volume.conf
systemctl daemon-reload
mount "$src"
mountpoint -q "$src"
systemctl start docker
trap - ERR

sleep 15
docker ps --format 'table {{.Names}}\t{{.Status}}'
echo
echo "Done. Volumes are on $vol. Check both apps, then after a week:"
echo "  sudo rm -rf $src.pre-ebs"
