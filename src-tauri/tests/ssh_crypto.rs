use ssh2::{MethodType, Session};

#[test]
fn ssh_backend_supports_modern_and_existing_servers() {
    let session = Session::new().expect("SSH backend must initialize");

    // Modern OpenSSH servers may offer only elliptic-curve key exchange.
    // Keep checking traditional algorithms for existing servers as well.
    for (method, required) in [
        (MethodType::Kex, "curve25519-sha256"),
        (MethodType::Kex, "ecdh-sha2-nistp256"),
        (MethodType::Kex, "diffie-hellman-group14-sha256"),
        (MethodType::HostKey, "ssh-ed25519"),
        (MethodType::HostKey, "rsa-sha2-256"),
        (MethodType::CryptCs, "aes128-ctr"),
        (MethodType::CryptSc, "aes128-ctr"),
        (MethodType::MacCs, "hmac-sha2-256"),
        (MethodType::MacSc, "hmac-sha2-256"),
    ] {
        let supported = session
            .supported_algs(method)
            .expect("SSH backend must report its supported algorithms");
        assert!(
            supported.contains(&required),
            "SSH backend is missing {required}; supported algorithms: {supported:?}"
        );
    }
}
