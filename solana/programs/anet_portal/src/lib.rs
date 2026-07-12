//! ╔══════════════════════════════════════════════════════════════════════════╗
//! ║ anet_portal — canonical ANET L1 ⇆ Solana bridge (mint & burn)             ║
//! ╠══════════════════════════════════════════════════════════════════════════╣
//! ║ Solana spoke of the ANET multi-chain gateway. Controls an SPL wANET mint  ║
//! ║ and is its ONLY mint/burn authority.                                      ║
//! ║                                                                           ║
//! ║   • BRIDGE-IN  (L1 → Solana): native ANET is LOCKED on the L1 hub. The    ║
//! ║     same M-of-N relayer signer set that secures the EVM spokes signs an   ║
//! ║     EIP-712 attestation of that lock; `bridge_in` verifies the signatures ║
//! ║     on-chain (secp256k1_recover + keccak) and MINTS wANET 1:1 to the      ║
//! ║     recipient's associated token account. Each `message_id` mints once    ║
//! ║     (a receipt PDA makes replay impossible).                              ║
//! ║   • BRIDGE-OUT (Solana → L1): a holder calls `bridge_out`, which BURNS    ║
//! ║     their wANET and emits `BridgeOut`. Relayers observe it and UNLOCK the ║
//! ║     same amount of native ANET on L1. Permissionless.                     ║
//! ║                                                                           ║
//! ║ SINGLE CANONICAL SUPPLY                                                    ║
//! ║   wANET is minted 1:1 only against ANET locked on L1 and burned 1:1 on    ║
//! ║   the way back, so  Σ wANET(all spokes) == ANET locked on L1  and no      ║
//! ║   chain can inflate the 21,000,000 canonical supply.                      ║
//! ║                                                                           ║
//! ║ CROSS-CHAIN SIGNER UNIFICATION                                             ║
//! ║   The attestation is an Ethereum-style EIP-712 digest so the SAME relayer  ║
//! ║   secp256k1 keys that sign for BSC/ETH also sign for Solana. The typed     ║
//! ║   struct is Solana-specific (`recipient` is a 32-byte Solana pubkey and    ║
//! ║   `amount` is in 8-decimal base units == L1 ANTS, 1:1) and the domain is   ║
//! ║   bound to this program (chain_id + verifying_contract) so a signature     ║
//! ║   for Solana can never be replayed on an EVM spoke, or vice-versa.         ║
//! ║                                                                           ║
//! ║ NOTE — decimals: SPL wANET uses 8 decimals to match L1 ANTS exactly, so    ║
//! ║ `amount` in the attestation is ANTS with no scaling. (EVM wANET uses 18    ║
//! ║ decimals; the relayer converts per-spoke.)                                ║
//! ║                                                                           ║
//! ║ PRE-AUDIT: written for devnet/testnet. Admin param changes are 2-step but  ║
//! ║ NOT yet time-locked (the EVM spokes have a 48h timelock); adding a Solana  ║
//! ║ timelock + on-chain per-recipient caps is a pre-mainnet task. Do NOT hold  ║
//! ║ real value here until an external audit is complete.                       ║
//! ╚══════════════════════════════════════════════════════════════════════════╝

use anchor_lang::prelude::*;
use anchor_lang::solana_program::keccak;
use anchor_lang::solana_program::secp256k1_recover::secp256k1_recover;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token::{self, Burn, Mint, MintTo, Token, TokenAccount};

declare_id!("Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS");

// ── Constants ───────────────────────────────────────────────────────────────
pub const MAX_SIGNERS: usize = 16;
pub const WANET_DECIMALS: u8 = 8; // matches L1 ANTS (1 ANET = 100_000_000 ANTS)
/// 21,000,000 ANET expressed in ANTS (8 decimals) — the canonical hard cap.
pub const MAX_SUPPLY_ANTS: u64 = 21_000_000u64 * 100_000_000u64;
pub const WINDOW_HOURS: usize = 24;

pub const CONFIG_SEED: &[u8] = b"config";
pub const MINT_AUTH_SEED: &[u8] = b"mint_authority";
pub const RECEIPT_SEED: &[u8] = b"receipt";

pub const DOMAIN_NAME: &[u8] = b"AnetMintBurnPortalSolana";
pub const DOMAIN_VERSION: &[u8] = b"1";

#[program]
pub mod anet_portal {
    use super::*;

    /// One-time setup. Creates the SPL wANET mint (authority = program PDA) and
    /// records the signer set, threshold, caps and EIP-712 domain binding.
    pub fn initialize(ctx: Context<Initialize>, params: InitializeParams) -> Result<()> {
        require!(params.threshold >= 1, PortalError::BadThreshold);
        require!(
            (params.threshold as usize) <= params.signers.len(),
            PortalError::BadThreshold
        );
        require!(
            params.signers.len() <= MAX_SIGNERS && !params.signers.is_empty(),
            PortalError::TooManySigners
        );
        require!(
            no_zero_or_dup_signers(&params.signers),
            PortalError::InvalidSigner
        );
        require!(params.max_per_tx > 0, PortalError::BadCaps);
        require!(
            params.max_global_24h >= params.max_per_tx,
            PortalError::BadCaps
        );

        let cfg = &mut ctx.accounts.config;
        cfg.admin = ctx.accounts.admin.key();
        cfg.pending_admin = Pubkey::default();
        cfg.pauser = params.pauser;
        cfg.paused = false;
        cfg.wanet_mint = ctx.accounts.wanet_mint.key();
        cfg.mint_authority_bump = ctx.bumps.mint_authority;
        cfg.config_bump = ctx.bumps.config;

        cfg.signer_count = params.signers.len() as u8;
        cfg.signers = [[0u8; 20]; MAX_SIGNERS];
        for (i, s) in params.signers.iter().enumerate() {
            cfg.signers[i] = *s;
        }
        cfg.threshold = params.threshold;

        cfg.eip712_chain_id = params.eip712_chain_id;
        cfg.eip712_verifying_contract = params.eip712_verifying_contract;

        cfg.max_per_tx = params.max_per_tx;
        cfg.max_global_24h = params.max_global_24h;
        cfg.global_slots = [HourSlot { hour: 0, amount: 0 }; WINDOW_HOURS];

        cfg.total_minted = 0;
        cfg.total_burned = 0;
        cfg.bridge_out_count = 0;

        emit!(PortalInitialized {
            admin: cfg.admin,
            wanet_mint: cfg.wanet_mint,
            threshold: cfg.threshold,
            signer_count: cfg.signer_count,
        });
        Ok(())
    }

    /// BRIDGE-IN: mint wANET 1:1 against an attested L1 lock.
    /// `sigs` are 65-byte Ethereum signatures (r‖s‖v) from the relayer signer
    /// set, sorted STRICTLY ASCENDING by recovered address.
    pub fn bridge_in(ctx: Context<BridgeIn>, req: MintReqSol, sigs: Vec<[u8; 65]>) -> Result<()> {
        let cfg = &mut ctx.accounts.config;
        require!(!cfg.paused, PortalError::Paused);
        require!(req.amount > 0, PortalError::ZeroAmount);
        require_keys_eq!(
            ctx.accounts.recipient.key(),
            Pubkey::new_from_array(req.recipient),
            PortalError::RecipientMismatch
        );

        let now = Clock::get()?.unix_timestamp;
        require!(now as u64 <= req.deadline, PortalError::Expired);

        // ── Verify M-of-N EIP-712 signatures ─────────────────────────────────
        let digest = cfg.bridge_in_digest(&req);
        let mut valid: u8 = 0;
        let mut last_addr = [0u8; 20]; // enforce strictly-ascending, unique
        for sig in sigs.iter() {
            let addr = match recover_eth_address(&digest, sig) {
                Some(a) => a,
                None => continue,
            };
            require!(gt_addr(&addr, &last_addr), PortalError::UnsortedSigners);
            require!(cfg.is_signer(&addr), PortalError::InvalidSigner);
            last_addr = addr;
            valid = valid.saturating_add(1);
        }
        require!(valid >= cfg.threshold, PortalError::ThresholdNotMet);

        // ── Caps + canonical hard-cap ────────────────────────────────────────
        require!(req.amount <= cfg.max_per_tx, PortalError::OverPerTxCap);
        cfg.accrue_global(now, req.amount)?;
        let new_supply = ctx
            .accounts
            .wanet_mint
            .supply
            .checked_add(req.amount)
            .ok_or(PortalError::MathOverflow)?;
        require!(new_supply <= MAX_SUPPLY_ANTS, PortalError::SupplyCap);

        // ── Replay lock: record the receipt PDA (init fails if it exists) ────
        let receipt = &mut ctx.accounts.mint_receipt;
        receipt.message_id = req.message_id;
        receipt.recipient = req.recipient;
        receipt.amount = req.amount;
        receipt.minted_at = now;

        // ── Mint via CPI (authority = program PDA) ───────────────────────────
        let bump = cfg.mint_authority_bump;
        let signer_seeds: &[&[&[u8]]] = &[&[MINT_AUTH_SEED, &[bump]]];
        token::mint_to(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                MintTo {
                    mint: ctx.accounts.wanet_mint.to_account_info(),
                    to: ctx.accounts.recipient_token_account.to_account_info(),
                    authority: ctx.accounts.mint_authority.to_account_info(),
                },
                signer_seeds,
            ),
            req.amount,
        )?;

        cfg.total_minted = cfg
            .total_minted
            .checked_add(req.amount)
            .ok_or(PortalError::MathOverflow)?;

        emit!(BridgeInMinted {
            message_id: req.message_id,
            src_chain_id: req.src_chain_id,
            recipient: ctx.accounts.recipient.key(),
            amount: req.amount,
        });
        Ok(())
    }

    /// BRIDGE-OUT: burn the caller's wANET and emit an event the relayer relays
    /// to the L1 hub to unlock native ANET. Permissionless.
    pub fn bridge_out(
        ctx: Context<BridgeOut>,
        amount: u64,
        l1_recipient: String,
        memo: String,
    ) -> Result<()> {
        let cfg = &mut ctx.accounts.config;
        require!(!cfg.paused, PortalError::Paused);
        require!(amount > 0, PortalError::ZeroAmount);
        require!(l1_recipient.len() <= 64, PortalError::L1AddrTooLong);
        require!(memo.len() <= 256, PortalError::MemoTooLong);

        token::burn(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                Burn {
                    mint: ctx.accounts.wanet_mint.to_account_info(),
                    from: ctx.accounts.user_token_account.to_account_info(),
                    authority: ctx.accounts.user.to_account_info(),
                },
            ),
            amount,
        )?;

        cfg.total_burned = cfg
            .total_burned
            .checked_add(amount)
            .ok_or(PortalError::MathOverflow)?;
        cfg.bridge_out_count = cfg.bridge_out_count.saturating_add(1);

        emit!(BridgeOut {
            nonce: cfg.bridge_out_count,
            from: ctx.accounts.user.key(),
            l1_recipient,
            amount,
            memo,
        });
        Ok(())
    }

    /// Emergency pause / unpause. Callable by the cold pauser key or the admin.
    pub fn set_paused(ctx: Context<AdminOrPauser>, paused: bool) -> Result<()> {
        let cfg = &mut ctx.accounts.config;
        let who = ctx.accounts.authority.key();
        require!(
            who == cfg.admin || who == cfg.pauser,
            PortalError::Unauthorized
        );
        cfg.paused = paused;
        emit!(PausedSet { paused });
        Ok(())
    }

    /// Rotate the signer set / threshold (admin only). 2-step admin protects the
    /// key; a time-lock is a pre-mainnet addition (see module docs).
    pub fn set_signers(
        ctx: Context<AdminOnly>,
        signers: Vec<[u8; 20]>,
        threshold: u8,
    ) -> Result<()> {
        require!(threshold >= 1, PortalError::BadThreshold);
        require!(
            !signers.is_empty() && signers.len() <= MAX_SIGNERS,
            PortalError::TooManySigners
        );
        require!(
            (threshold as usize) <= signers.len(),
            PortalError::BadThreshold
        );
        require!(no_zero_or_dup_signers(&signers), PortalError::InvalidSigner);

        let cfg = &mut ctx.accounts.config;
        cfg.signers = [[0u8; 20]; MAX_SIGNERS];
        for (i, s) in signers.iter().enumerate() {
            cfg.signers[i] = *s;
        }
        cfg.signer_count = signers.len() as u8;
        cfg.threshold = threshold;
        emit!(SignersRotated {
            signer_count: cfg.signer_count,
            threshold
        });
        Ok(())
    }

    /// Update mint caps (admin only).
    pub fn set_caps(ctx: Context<AdminOnly>, max_per_tx: u64, max_global_24h: u64) -> Result<()> {
        require!(max_per_tx > 0, PortalError::BadCaps);
        require!(max_global_24h >= max_per_tx, PortalError::BadCaps);
        let cfg = &mut ctx.accounts.config;
        cfg.max_per_tx = max_per_tx;
        cfg.max_global_24h = max_global_24h;
        emit!(CapsSet {
            max_per_tx,
            max_global_24h
        });
        Ok(())
    }

    /// Rotate the pauser key (admin only).
    pub fn set_pauser(ctx: Context<AdminOnly>, new_pauser: Pubkey) -> Result<()> {
        require!(new_pauser != Pubkey::default(), PortalError::Unauthorized);
        ctx.accounts.config.pauser = new_pauser;
        Ok(())
    }

    /// Step 1 of admin transfer (current admin nominates a successor).
    pub fn transfer_admin(ctx: Context<AdminOnly>, new_admin: Pubkey) -> Result<()> {
        require!(new_admin != Pubkey::default(), PortalError::Unauthorized);
        ctx.accounts.config.pending_admin = new_admin;
        Ok(())
    }

    /// Step 2 of admin transfer (nominee accepts).
    pub fn accept_admin(ctx: Context<AcceptAdmin>) -> Result<()> {
        let cfg = &mut ctx.accounts.config;
        require_keys_eq!(
            ctx.accounts.new_admin.key(),
            cfg.pending_admin,
            PortalError::Unauthorized
        );
        cfg.admin = cfg.pending_admin;
        cfg.pending_admin = Pubkey::default();
        emit!(AdminTransferred { new_admin: cfg.admin });
        Ok(())
    }
}

// ── State ─────────────────────────────────────────────────────────────────────

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy)]
pub struct HourSlot {
    pub hour: u64,
    pub amount: u64,
}

#[account]
pub struct PortalConfig {
    pub admin: Pubkey,
    pub pending_admin: Pubkey,
    pub pauser: Pubkey,
    pub paused: bool,
    pub wanet_mint: Pubkey,
    pub mint_authority_bump: u8,
    pub config_bump: u8,
    pub signer_count: u8,
    pub signers: [[u8; 20]; MAX_SIGNERS],
    pub threshold: u8,
    pub eip712_chain_id: u64,
    pub eip712_verifying_contract: [u8; 20],
    pub max_per_tx: u64,
    pub max_global_24h: u64,
    pub global_slots: [HourSlot; WINDOW_HOURS],
    pub total_minted: u64,
    pub total_burned: u64,
    pub bridge_out_count: u64,
}

impl PortalConfig {
    // discriminator(8) + 3*32 admin/pending/pauser + 1 paused + 32 mint
    // + 1 mint_bump + 1 config_bump + 1 signer_count + 20*16 signers
    // + 1 threshold + 8 chain_id + 20 vc + 8 max_per_tx + 8 max_global
    // + 16*24 slots + 8 total_minted + 8 total_burned + 8 bridge_out_count
    pub const LEN: usize =
        8 + 32 + 32 + 32 + 1 + 32 + 1 + 1 + 1 + (20 * MAX_SIGNERS) + 1 + 8 + 20 + 8 + 8 + (16 * WINDOW_HOURS) + 8 + 8 + 8;

    fn is_signer(&self, addr: &[u8; 20]) -> bool {
        self.signers[..self.signer_count as usize]
            .iter()
            .any(|s| s == addr)
    }

    /// keccak256 EIP-712 digest of a BridgeInSol attestation.
    fn bridge_in_digest(&self, req: &MintReqSol) -> [u8; 32] {
        // EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)
        let domain_typehash = keccak::hash(
            b"EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)",
        )
        .0;
        let name_hash = keccak::hash(DOMAIN_NAME).0;
        let version_hash = keccak::hash(DOMAIN_VERSION).0;
        let domain_separator = keccak::hashv(&[
            &domain_typehash,
            &name_hash,
            &version_hash,
            &pad32_u64(self.eip712_chain_id),
            &pad32_addr(&self.eip712_verifying_contract),
        ])
        .0;

        // BridgeInSol(bytes32 messageId,uint256 srcChainId,bytes32 recipient,uint256 amount,uint256 deadline)
        let type_hash = keccak::hash(
            b"BridgeInSol(bytes32 messageId,uint256 srcChainId,bytes32 recipient,uint256 amount,uint256 deadline)",
        )
        .0;
        let struct_hash = keccak::hashv(&[
            &type_hash,
            &req.message_id,
            &pad32_u64(req.src_chain_id),
            &req.recipient, // already 32 bytes
            &pad32_u64(req.amount),
            &pad32_u64(req.deadline),
        ])
        .0;

        keccak::hashv(&[&[0x19, 0x01], &domain_separator, &struct_hash]).0
    }

    /// Rolling 24h global cap using 24 hourly buckets (mirrors the EVM spokes).
    fn accrue_global(&mut self, now_ts: i64, amount: u64) -> Result<()> {
        let hour = (now_ts as u64) / 3600;
        let mut windowed: u64 = 0;
        let idx = (hour as usize) % WINDOW_HOURS;
        for slot in self.global_slots.iter() {
            if slot.hour + (WINDOW_HOURS as u64) > hour {
                windowed = windowed.saturating_add(slot.amount);
            }
        }
        require!(
            windowed.checked_add(amount).ok_or(PortalError::MathOverflow)? <= self.max_global_24h,
            PortalError::OverGlobalCap
        );
        if self.global_slots[idx].hour == hour {
            self.global_slots[idx].amount = self.global_slots[idx]
                .amount
                .checked_add(amount)
                .ok_or(PortalError::MathOverflow)?;
        } else {
            self.global_slots[idx] = HourSlot { hour, amount };
        }
        Ok(())
    }
}

#[account]
pub struct MintReceipt {
    pub message_id: [u8; 32],
    pub recipient: [u8; 32],
    pub amount: u64,
    pub minted_at: i64,
}
impl MintReceipt {
    pub const LEN: usize = 8 + 32 + 32 + 8 + 8;
}

// ── Instruction params ─────────────────────────────────────────────────────────

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct InitializeParams {
    pub pauser: Pubkey,
    pub signers: Vec<[u8; 20]>,
    pub threshold: u8,
    pub eip712_chain_id: u64,
    pub eip712_verifying_contract: [u8; 20],
    pub max_per_tx: u64,
    pub max_global_24h: u64,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct MintReqSol {
    pub message_id: [u8; 32],
    pub src_chain_id: u64,
    pub recipient: [u8; 32],
    pub amount: u64,
    pub deadline: u64,
}

// ── Accounts ──────────────────────────────────────────────────────────────────

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(
        init,
        payer = admin,
        space = PortalConfig::LEN,
        seeds = [CONFIG_SEED],
        bump
    )]
    pub config: Account<'info, PortalConfig>,

    /// CHECK: PDA that is the sole mint authority for wANET.
    #[account(seeds = [MINT_AUTH_SEED], bump)]
    pub mint_authority: UncheckedAccount<'info>,

    #[account(
        init,
        payer = admin,
        mint::decimals = WANET_DECIMALS,
        mint::authority = mint_authority,
    )]
    pub wanet_mint: Account<'info, Mint>,

    #[account(mut)]
    pub admin: Signer<'info>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
#[instruction(req: MintReqSol)]
pub struct BridgeIn<'info> {
    #[account(mut, seeds = [CONFIG_SEED], bump = config.config_bump)]
    pub config: Account<'info, PortalConfig>,

    #[account(
        init,
        payer = payer,
        space = MintReceipt::LEN,
        seeds = [RECEIPT_SEED, req.message_id.as_ref()],
        bump
    )]
    pub mint_receipt: Account<'info, MintReceipt>,

    #[account(mut, address = config.wanet_mint)]
    pub wanet_mint: Account<'info, Mint>,

    /// CHECK: PDA mint authority, verified by seeds.
    #[account(seeds = [MINT_AUTH_SEED], bump = config.mint_authority_bump)]
    pub mint_authority: UncheckedAccount<'info>,

    /// CHECK: recipient wallet; its key must equal req.recipient (checked in ix).
    pub recipient: UncheckedAccount<'info>,

    #[account(
        init_if_needed,
        payer = payer,
        associated_token::mint = wanet_mint,
        associated_token::authority = recipient,
    )]
    pub recipient_token_account: Account<'info, TokenAccount>,

    #[account(mut)]
    pub payer: Signer<'info>,

    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct BridgeOut<'info> {
    #[account(mut, seeds = [CONFIG_SEED], bump = config.config_bump)]
    pub config: Account<'info, PortalConfig>,

    #[account(mut, address = config.wanet_mint)]
    pub wanet_mint: Account<'info, Mint>,

    #[account(mut)]
    pub user: Signer<'info>,

    #[account(
        mut,
        token::mint = wanet_mint,
        token::authority = user,
    )]
    pub user_token_account: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct AdminOnly<'info> {
    #[account(mut, seeds = [CONFIG_SEED], bump = config.config_bump, has_one = admin)]
    pub config: Account<'info, PortalConfig>,
    pub admin: Signer<'info>,
}

#[derive(Accounts)]
pub struct AdminOrPauser<'info> {
    #[account(mut, seeds = [CONFIG_SEED], bump = config.config_bump)]
    pub config: Account<'info, PortalConfig>,
    pub authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct AcceptAdmin<'info> {
    #[account(mut, seeds = [CONFIG_SEED], bump = config.config_bump)]
    pub config: Account<'info, PortalConfig>,
    pub new_admin: Signer<'info>,
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/// Left-pad a u64 into a 32-byte big-endian word (EIP-712 uint256 encoding).
fn pad32_u64(v: u64) -> [u8; 32] {
    let mut out = [0u8; 32];
    out[24..].copy_from_slice(&v.to_be_bytes());
    out
}

/// Left-pad a 20-byte address into a 32-byte word (EIP-712 address encoding).
fn pad32_addr(addr: &[u8; 20]) -> [u8; 32] {
    let mut out = [0u8; 32];
    out[12..].copy_from_slice(addr);
    out
}

/// Compare two 20-byte addresses as big-endian integers: a > b ?
fn gt_addr(a: &[u8; 20], b: &[u8; 20]) -> bool {
    for i in 0..20 {
        if a[i] != b[i] {
            return a[i] > b[i];
        }
    }
    false
}

fn no_zero_or_dup_signers(signers: &[[u8; 20]]) -> bool {
    for (i, s) in signers.iter().enumerate() {
        if *s == [0u8; 20] {
            return false;
        }
        for other in &signers[i + 1..] {
            if other == s {
                return false;
            }
        }
    }
    true
}

/// secp256k1 half-order (EIP-2 low-s bound): recovered signatures with s above
/// this are rejected to prevent signature malleability.
const SECP256K1_HALF_ORDER: [u8; 32] = [
    0x7f, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff,
    0x5d, 0x57, 0x6e, 0x73, 0x57, 0xa4, 0x50, 0x1d, 0xdf, 0xe9, 0x2f, 0x46, 0x68, 0x1b, 0x20, 0xa0,
];

/// Recover the 20-byte Ethereum address from a 65-byte (r‖s‖v) signature over a
/// 32-byte keccak digest. Enforces EIP-2 low-s. Returns None on any failure.
fn recover_eth_address(digest: &[u8; 32], sig: &[u8; 65]) -> Option<[u8; 20]> {
    let mut rs = [0u8; 64];
    rs.copy_from_slice(&sig[..64]);

    // low-s check (s = sig[32..64])
    let mut s = [0u8; 32];
    s.copy_from_slice(&sig[32..64]);
    if !leq_be(&s, &SECP256K1_HALF_ORDER) {
        return None;
    }

    let v = sig[64];
    let recovery_id = match v {
        27 => 0u8,
        28 => 1u8,
        0 | 1 => v,
        _ => return None,
    };

    let pubkey = secp256k1_recover(digest, recovery_id, &rs).ok()?;
    // Ethereum address = last 20 bytes of keccak256(uncompressed pubkey x‖y).
    let hash = keccak::hash(&pubkey.to_bytes()).0;
    let mut addr = [0u8; 20];
    addr.copy_from_slice(&hash[12..]);
    Some(addr)
}

/// a <= b for 32-byte big-endian integers.
fn leq_be(a: &[u8; 32], b: &[u8; 32]) -> bool {
    for i in 0..32 {
        if a[i] != b[i] {
            return a[i] < b[i];
        }
    }
    true
}

// ── Events ────────────────────────────────────────────────────────────────────

#[event]
pub struct PortalInitialized {
    pub admin: Pubkey,
    pub wanet_mint: Pubkey,
    pub threshold: u8,
    pub signer_count: u8,
}

#[event]
pub struct BridgeInMinted {
    pub message_id: [u8; 32],
    pub src_chain_id: u64,
    pub recipient: Pubkey,
    pub amount: u64,
}

#[event]
pub struct BridgeOut {
    pub nonce: u64,
    pub from: Pubkey,
    pub l1_recipient: String,
    pub amount: u64,
    pub memo: String,
}

#[event]
pub struct PausedSet {
    pub paused: bool,
}

#[event]
pub struct SignersRotated {
    pub signer_count: u8,
    pub threshold: u8,
}

#[event]
pub struct CapsSet {
    pub max_per_tx: u64,
    pub max_global_24h: u64,
}

#[event]
pub struct AdminTransferred {
    pub new_admin: Pubkey,
}

// ── Errors ────────────────────────────────────────────────────────────────────

#[error_code]
pub enum PortalError {
    #[msg("Portal is paused")]
    Paused,
    #[msg("Amount must be greater than zero")]
    ZeroAmount,
    #[msg("Recipient account does not match attestation")]
    RecipientMismatch,
    #[msg("Attestation deadline has passed")]
    Expired,
    #[msg("Signatures are not strictly ascending / unique by address")]
    UnsortedSigners,
    #[msg("Recovered address is not an authorized signer")]
    InvalidSigner,
    #[msg("Not enough valid signatures for threshold")]
    ThresholdNotMet,
    #[msg("Amount exceeds per-transaction cap")]
    OverPerTxCap,
    #[msg("Amount exceeds rolling 24h global cap")]
    OverGlobalCap,
    #[msg("Would exceed the 21,000,000 canonical supply cap")]
    SupplyCap,
    #[msg("Bad threshold")]
    BadThreshold,
    #[msg("Too many signers")]
    TooManySigners,
    #[msg("Bad caps")]
    BadCaps,
    #[msg("L1 recipient string too long")]
    L1AddrTooLong,
    #[msg("Memo too long")]
    MemoTooLong,
    #[msg("Unauthorized")]
    Unauthorized,
    #[msg("Math overflow")]
    MathOverflow,
}
