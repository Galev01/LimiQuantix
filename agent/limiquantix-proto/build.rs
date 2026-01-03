//! Build script for generating Rust code from protobuf definitions.
//!
//! This build script will skip proto generation if:
//! - The generated files already exist AND
//! - protoc is not available
//!
//! To force regeneration, delete the generated files and install protoc.

use std::path::PathBuf;

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let out_dir = PathBuf::from("src/generated");
    
    // Check if generated files already exist
    let node_rs = out_dir.join("limiquantix.node.v1.rs");
    let agent_rs = out_dir.join("limiquantix.agent.v1.rs");
    
    let files_exist = node_rs.exists() && agent_rs.exists();
    
    // Check if protoc is available
    let protoc_available = std::process::Command::new("protoc")
        .arg("--version")
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false);
    
    // Skip regeneration if files exist and protoc is not available
    if files_exist && !protoc_available {
        println!("cargo:warning=Using pre-generated proto files (protoc not found)");
        println!("cargo:rerun-if-changed=proto/node_daemon.proto");
        println!("cargo:rerun-if-changed=proto/agent.proto");
        return Ok(());
    }
    
    // If protoc is not available and files don't exist, we have a problem
    if !protoc_available && !files_exist {
        return Err("protoc not found and no pre-generated files exist. Please install protoc.".into());
    }
    
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
