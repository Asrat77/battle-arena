# AWS deploy (single EC2 instance)

1. Launch Ubuntu 24.04, t3.small, 20 GB gp3, security group open on 22 (your IP), 80, 443. Attach an Elastic IP.
2. `sudo apt-get update && sudo apt-get install -y docker.io docker-compose-v2 git`
3. `git clone https://github.com/Asrat77/battle-arena && cd battle-arena`
4. `cp deploy/.env.example .env`, fill in hosts and `LEDGER_PRIVATE_KEY`.
5. `sudo docker compose up -d --build`

Data (profiles, ledger) lives in the `arena-data` volume on the instance's EBS disk and survives restarts and rebuilds.
Update: `git pull && sudo docker compose up -d --build`.
Check: `https://$API_HOST/health`.
