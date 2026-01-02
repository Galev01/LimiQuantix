//! Build script for generating Rust code from protobuf definitions.

use std::path::PathBuf;

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let out_dir = PathBuf::from("src/generated");
    
    // Create output directory if it doesn't exist
    std::fs::create_dir_all(&out_dir)?;
    
    // Proto files to compile
    let proto_files = vec![
        PathBuf::from("proto/node_daemon.proto"),
        PathBuf::from("proto/agent.proto"),
    ];
    
    // Check which proto files exist
    let existing_protos: Vec<PathBuf> = proto_files
        .into_iter()
        .filter(|p| {
            if p.exists() {
                println!("cargo:rerun-if-changed={}", p.display());
                true
            } else {
                println!("cargo:warning=Proto file not found: {:?}", p);
                false
            }
        })
        .collect();
    
    if existing_protos.is_empty() {
        println!("cargo:warning=No proto files found");
        return Ok(());
    }
    
    // Configure tonic-build
    tonic_build::configure()
        .build_server(true)
        .build_client(true)
        .out_dir(&out_dir)
        .compile(&existing_protos, &[PathBuf::from("proto")])?;
    
    Ok(())
}
