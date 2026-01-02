//! Build script for generating Rust code from protobuf definitions.

use std::path::PathBuf;

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let out_dir = PathBuf::from("src/generated");
    
    // Create output directory if it doesn't exist
    std::fs::create_dir_all(&out_dir)?;
    
    // Use local proto file (simplified, standalone)
    let proto_file = PathBuf::from("proto/node_daemon.proto");
    
    if !proto_file.exists() {
        println!("cargo:warning=Proto file not found: {:?}", proto_file);
        return Ok(());
    }
    
    println!("cargo:rerun-if-changed=proto/node_daemon.proto");
    
    // Configure tonic-build
    tonic_build::configure()
        .build_server(true)
        .build_client(true)
        .out_dir(&out_dir)
        .compile(&[proto_file], &[PathBuf::from("proto")])?;
    
    Ok(())
}
