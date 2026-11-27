#!/usr/bin/env bash
# Manage the ConqChat deployment on Microsoft Azure with the Azure CLI (az).
# Run from Git Bash or Azure Cloud Shell after `az login`.
#
#   bash deploy/azure.sh create     # resource group + Ubuntu VM + firewall rules, then installs the app
#   bash deploy/azure.sh ip         # print the public IP and URLs
#   bash deploy/azure.sh ssh        # open a terminal on the VM
#   bash deploy/azure.sh update     # git pull + re-run setup on the VM
#   bash deploy/azure.sh allow-me   # move the SSH rule to your current public IP
#   bash deploy/azure.sh stop       # deallocate the VM (stops compute charges; disk + IP still billed)
#   bash deploy/azure.sh start      # start it again
#   bash deploy/azure.sh delete     # delete EVERYTHING in the resource group (safe cleanup)
set -euo pipefail

RG=${RG:-conqchat-rg}
LOCATION=${LOCATION:-uksouth}
VM=${VM:-conqchat-vm}
NSG="${VM}NSG"                                  # name az vm create gives the network security group
ADMIN=${ADMIN:-azureuser}
REPO=${REPO:-https://github.com/Conqy-dev/CHAT-APP.git}
AZ=${AZ:-az}

my_ip() { curl -s https://api.ipify.org; }
public_ip() { $AZ vm show -d -g "$RG" -n "$VM" --query publicIps -o tsv; }
on_vm() { ssh -o StrictHostKeyChecking=accept-new "$ADMIN@$(public_ip)" "$@"; }

rule() {  # name priority port source
    $AZ network nsg rule create -g "$RG" --nsg-name "$NSG" -n "$1" --priority "$2" --direction Inbound \
        --access Allow --protocol Tcp --destination-port-ranges "$3" --source-address-prefixes "$4" -o none
    echo "   allow TCP $3 from $4"
}

case "${1:-}" in
create)
    echo "==> Resource group $RG in $LOCATION"
    $AZ group create -n "$RG" -l "$LOCATION" -o none
    echo "==> Ubuntu 24.04 VM ($VM, Standard_B1s) with a static public IP and no open ports yet"
    $AZ vm create -g "$RG" -n "$VM" --image Ubuntu2404 --size Standard_B1s \
        --admin-username "$ADMIN" --generate-ssh-keys --public-ip-sku Standard \
        --storage-sku StandardSSD_LRS --nsg-rule NONE -o table
    echo "==> Firewall (Network Security Group) inbound rules. Everything else stays blocked."
    rule allow-ssh-admin 1000 22 "$(my_ip)/32"   # administration: only from this computer's IP
    rule allow-http      1010 80 Internet         # browsers -> nginx
    rule allow-chat-tcp  1020 5000 Internet       # terminal clients -> raw TCP chat server
    echo "==> Installing the app on the VM"
    sleep 20                                      # give the VM's SSH server a moment
    on_vm "git clone $REPO chat-app 2>/dev/null || (cd chat-app && git pull); cd chat-app && bash deploy/setup.sh"
    "$0" ip
    ;;
ip)
    ip=$(public_ip)
    echo "Web app:     http://$ip"
    echo "TCP client:  python client/chat_client.py --host $ip --port 5000"
    echo "SSH:         ssh $ADMIN@$ip"
    ;;
ssh)    on_vm ;;
update) on_vm "cd chat-app && git pull && bash deploy/setup.sh" ;;
allow-me) rule allow-ssh-admin 1000 22 "$(my_ip)/32" ;;
stop)   $AZ vm deallocate -g "$RG" -n "$VM" && echo "VM deallocated (compute billing stopped)." ;;
start)  $AZ vm start -g "$RG" -n "$VM" && "$0" ip ;;
delete)
    read -r -p "Delete resource group $RG and ALL resources in it? Type the name to confirm: " answer
    [ "$answer" = "$RG" ] || { echo "Cancelled."; exit 1; }
    $AZ group delete -n "$RG" --yes && echo "Deleted. Nothing left to bill in $RG."
    ;;
*)  sed -n '2,13p' "$0"; exit 1 ;;
esac
