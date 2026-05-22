#!/bin/bash

# Create zalo_data directory if it doesn't exist
mkdir -p zalo_data

# Create proxies.json if it doesn't exist
if [ ! -f "./zalo_data/proxies.json" ]; then
    echo "[]" > ./zalo_data/proxies.json
    echo "Created empty proxies.json"
fi

# Create webhook-config.json if it doesn't exist (Legacy)
# if [ ! -f "./zalo_data/webhook-config.json" ]; then
#     cat > ./zalo_data/webhook-config.json << EOF
# {
#   "messageWebhookUrl": "",
#   "groupEventWebhookUrl": "",
#   "reactionWebhookUrl": ""
# }
# EOF
#     echo "Created webhook-config.json template"
# fi

# Create webhooks.json if it doesn't exist
if [ ! -f "./zalo_data/webhooks.json" ]; then
    echo "{}" > ./zalo_data/webhooks.json
    echo "Created empty webhooks.json"
fi

echo "Setup completed. You can now run 'docker-compose up -d'" 