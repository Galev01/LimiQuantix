//! Build script for generating Rust code from protobuf definitions.
//!
//! This build script will skip proto generation if:
//! - The generated files already exist AND
//! - protoc is not available
//!
//! To force regeneration, delete the generated files and install protoc.

use std::path::PathBuf;
use std::env;

fn main() -> Result<(), Box<dyn std::error::Error>> {
    // Get the manifest directory (where Cargo.toml lives)
    let manifest_dir = PathBuf::from(env::var("CARGO_MANIFEST_DIR")?);
    
    let out_dir = manifest_dir.join("src/generated");
    let proto_dir = manifest_dir.join("proto");
    
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
        println!("cargo:rerun-if-changed={}", proto_dir.join("node_daemon.proto").display());
        println!("cargo:rerun-if-changed={}", proto_dir.join("agent.proto").display());
        return Ok(());
    }
    
    // If protoc is not available and files don't exist, we have a problem
    if !protoc_available && !files_exist {
        return Err("protoc not found and no pre-generated files exist. Please install protoc.".into());
    }
    
    // Create output directory if it doesn't exist
    std::fs::create_dir_all(&out_dir)?;
    
    // Proto files to compile (using absolute paths)
    let proto_files = vec![
        proto_dir.join("node_daemon.proto"),
        proto_dir.join("agent.proto"),
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
        println!("cargo:warning=No proto files found in {:?}", proto_dir);
        return Ok(());
    }
    
    println!("cargo:warning=Generating proto files to {:?}", out_dir);
    println!("cargo:warning=Proto files: {:?}", existing_protos);
    println!("cargo:warning=Include dir: {:?}", proto_dir);
    
    // Configure tonic-build
    match tonic_build::configure()
        .build_server(true)
        .build_client(true)
        .out_dir(&out_dir)
        .compile(&existing_protos, &[&proto_dir])
    {
        Ok(_) => {
            println!("cargo:warning=Proto generation complete");
            
            // Verify files were created
            if node_rs.exists() {
                println!("cargo:warning=Generated: {:?}", node_rs);
            } else {
                println!("cargo:warning=ERROR: {:?} was not created!", node_rs);
            }
            if agent_rs.exists() {
                println!("cargo:warning=Generated: {:?}", agent_rs);
            } else {
                println!("cargo:warning=ERROR: {:?} was not created!", agent_rs);
            }
        }
        Err(e) => {
            println!("cargo:warning=Proto generation FAILED: {}", e);
            return Err(e.into());
        }
    }
    
    Ok(())
}
