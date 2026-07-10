#!/bin/bash

openssl genrsa -aes256 -out ca.key 4096
openssl req -new -x509 -sha256 -days 3650 -key ca.key -out ca.crt -subj "/C=BR/ST=Sao Paulo/L=Campins/O=Kyndryl/CN=Kyndryl-RootCA"
openssl genrsa -out mcp-server.key 2048
openssl req -new -key mcp-server.key -out mcp-server.csr -config mcp-server.cnf
openssl x509 -req -in mcp-server.csr -CA ca.crt -CAkey ca.key -CAcreateserial -out mcp-server.crt -days 365 -sha256 -extfile mcp-server.cnf -extensions v3_req

