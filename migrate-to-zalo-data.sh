#!/bin/bash

echo "Migrating to zalo_data directory structure..."

# Create zalo_data directory if it doesn't exist
mkdir -p zalo_data

# Copy existing proxies.json if it exists
if [ -f "./proxies.json" ]; then
    cp ./proxies.json ./zalo_data/
    echo "Copied existing proxies.json to zalo_data/"
else
    echo "[]" > ./zalo_data/proxies.json
    echo "Created empty proxies.json in zalo_data/"
fi

# Copy existing webhook-config.json if it exists (Legacy)
# if [ -f "./webhook-config.json" ]; then
#     cp ./webhook-config.json ./zalo_data/
#     echo "Copied existing webhook-config.json to zalo_data/"
# else
#     cat > ./zalo_data/webhook-config.json << EOF
# {
#   "messageWebhookUrl": "",
#   "groupEventWebhookUrl": "",
#   "reactionWebhookUrl": ""
# }
# EOF
#     echo "Created webhook-config.json template in zalo_data/"
# fi

# Copy existing webhooks.json if it exists
if [ -f "./webhooks.json" ]; then
    cp ./webhooks.json ./zalo_data/
    echo "Copied existing webhooks.json to zalo_data/"
else
    echo "{}" > ./zalo_data/webhooks.json
    echo "Created empty webhooks.json in zalo_data/"
fi

# Copy existing cookies directory contents if it exists
if [ -d "./cookies" ]; then
    cp ./cookies/cred_*.json ./zalo_data/ 2>/dev/null || true
    echo "Copied credential files to zalo_data/"
else
    echo "No existing cookies directory found"
fi

echo "Migration completed. You can now run 'docker-compose up -d'"
echo "The old files are still in their original location and can be safely removed after confirming everything works." 