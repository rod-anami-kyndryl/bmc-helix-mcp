#!/usr/bin/env bash

# Exit immediately if a command exits with a non-zero status
set -e

# Initialize variables
INPUT_URL=$1
PORT_ARG=$2

# Display usage helper
usage() {
    echo "Usage: $0 <website_url_or_hostname> [port] [output_file]"
    echo ""
    echo "Arguments:"
    echo "  website_url_or_hostname   The website to retrieve certificates from (e.g., https://your-helix-instance.onbmc.com)"
    echo "  port                      Optional. The TLS port (defaults to 443, or extracts from the input)"
    echo "  output_file               Optional. Path to save the PEM file (defaults to certs/helix-certs.pem)"
    echo ""
    echo "Example:"
    echo "  $0 https://your-helix-instance.onbmc.com"
    exit 1
}

if [ -z "$INPUT_URL" ]; then
    usage
fi

# Determine the directory of this script to locate helix-certs.pem reliably
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"

# Clean the URL to extract host and possibly port
# 1. Remove protocol if present (e.g., https://)
CLEANED_HOST=$(echo "$INPUT_URL" | sed -e 's|^[^/]*//||' -e 's|/.*||')

# 2. Extract port if specified in the hostname (e.g., hostname:8443)
HOST=$CLEANED_HOST
PORT=443

if [[ "$CLEANED_HOST" == *":"* ]]; then
    PORT=$(echo "$CLEANED_HOST" | cut -d':' -f2)
    HOST=$(echo "$CLEANED_HOST" | cut -d':' -f1)
fi

# Override port if passed as second argument
if [ -n "$PORT_ARG" ]; then
    PORT=$PORT_ARG
fi

# Output file path (third argument, or defaults to the same directory as this script as 'helix-certs.pem')
OUTPUT_FILE=${3:-"$SCRIPT_DIR/helix-certs.pem"}

echo "Connecting to $HOST:$PORT to retrieve CA and server certificates..."

# Verify openssl is installed
if ! command -v openssl &> /dev/null; then
    echo "Error: openssl utility is required but not installed." >&2
    exit 1
fi

# Temporary file to store the full openssl output
TEMP_OUT=$(mktemp)

# Run openssl client to get connection information and certificate chain
# We use -servername for SNI (Server Name Indication) which is critical for modern virtual hosts
# We use -showcerts to retrieve all certs in the chain (intermediates)
if ! openssl s_client -showcerts -connect "$HOST:$PORT" -servername "$HOST" </dev/null > "$TEMP_OUT" 2> /dev/null; then
    # Some older openssl versions might not support certain options, or the connection just failed.
    # Try a fallback without -servername just in case the server is extremely old or we got a network error
    echo "Warning: Initial connection failed or timed out. Retrying without SNI..."
    if ! openssl s_client -showcerts -connect "$HOST:$PORT" </dev/null > "$TEMP_OUT" 2> /dev/null; then
        echo "Error: Failed to connect to $HOST:$PORT using openssl." >&2
        rm -f "$TEMP_OUT"
        exit 1
    fi
fi

# Extract all certificates from the openssl output (everything between BEGIN and END CERTIFICATE blocks)
# sed extracts all blocks of PEM certificates.
sed -ne '/-BEGIN CERTIFICATE-/,/-END CERTIFICATE-/p' "$TEMP_OUT" > "$OUTPUT_FILE"

# Clean up temp file
rm -f "$TEMP_OUT"

# Verify we actually got some certificates
if [ ! -s "$OUTPUT_FILE" ]; then
    echo "Error: No certificates found or extracted. The response from $HOST:$PORT was empty." >&2
    rm -f "$OUTPUT_FILE"
    exit 1
fi

# Count the number of certificates extracted
CERT_COUNT=$(grep -c "BEGIN CERTIFICATE" "$OUTPUT_FILE")

echo "Successfully extracted $CERT_COUNT certificate(s) from $HOST:$PORT"
echo "Saved certificate chain to: $OUTPUT_FILE"
echo ""
echo "To use this in your BMC Helix MCP server, you can set the HELIX_CERT_PATH environment variable:"
echo "  export HELIX_CERT_PATH=\"$OUTPUT_FILE\""
echo "Or specify it in your .env configuration of the application."
