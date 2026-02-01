-- Rollback: 000013_networks

DROP TABLE IF EXISTS floating_ips;
DROP TABLE IF EXISTS bgp_advertisements;
DROP TABLE IF EXISTS bgp_peers;
DROP TABLE IF EXISTS bgp_speakers;
DROP TABLE IF EXISTS vpn_services;
DROP TABLE IF EXISTS load_balancers;
DROP TABLE IF EXISTS network_ports;
DROP TABLE IF EXISTS security_groups;
DROP TABLE IF EXISTS virtual_networks;
