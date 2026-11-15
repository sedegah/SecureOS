# Surge Portable — user guide

This guide is for using a Surge drive. If you want to build one from source, see
[technical notes](README.md).

## Contents

- [Starting Surge](#starting-surge)
- [Lock screen and profile](#lock-screen-and-profile)
- [The homepage](#the-homepage)
- [My Files](#my-files)
- [My Notes](#my-notes)
- [Bookmarks](#bookmarks)
- [Downloads](#downloads)
- [Passwords](#passwords)
- [Settings](#settings)
- [Shutting down safely](#shutting-down-safely)
- [Troubleshooting](#troubleshooting)

## Starting Surge

1. Plug the USB drive into the computer.
2. Open the drive in File Explorer.
3. Double-click **Surge.exe**.

Firefox opens with the Surge homepage. The first start on a new computer can take a few
seconds longer than usual.

You do not need internet to open Surge or to use Notes, Files, Bookmarks or Passwords.
You only need internet to load websites.

If Surge is already open, running `Surge.exe` again will not start a second copy.

## Lock screen and profile

The first time Surge starts on a new drive it asks for two things:

- **Your name** — shown on the lock screen, and used to greet you.
- **A password** — optional.

If you set a password, Surge asks for it every time the workspace opens. The password is
turned into a key with Argon2id and is never written to the drive in readable form, so
nobody can read it off the drive. It also cannot be recovered — if you forget it, use
**Forgot password?** on the lock screen to remove the lock and set a new one.

If you would rather not use a password, choose **Continue without a password** at setup,
or leave the password off in Settings. Surge then opens straight into the workspace and
never asks for a password.

Change any of this later in **Settings → Profile & lock screen**: add, change or remove the
password, rename the profile, or lock the workspace immediately with **Lock now**.

The lock screen is a curtain, not a lockbox. It keeps someone who picks up the drive from
browsing your workspace, but it does not encrypt your notes, bookmarks or files. Only the
password vault encrypts what it holds.

## The homepage

The homepage is your dashboard. From here you can:

- **Search or type an address.** Press Enter and the site opens in Firefox. Addresses
  like `example.com` go straight to the site; anything else is treated as a search.
- **Jump to a section** using the tiles or the menu on the left.
- **See your pinned bookmarks**, your most recently changed notes, and your latest
  downloads.
- **Check your free space** in the storage panel.

Keyboard users: press Tab to move between controls, and the arrow keys to move along the
section menu. The focused item is always outlined.

## My Files

A simple manager for the files on your Surge drive.

- Click a folder to open it; use the breadcrumb trail to go back up.
- Files show their type, size and last-modified date.
- **Open** a file with the computer's normal program for that type.
- **Show in folder** opens Windows Explorer at that file.
- **New folder**, **Rename**, **Copy to**, **Move to** and **Delete** are in each row's
  actions.

Deletes always ask you to confirm first, and they are permanent — there is no recycle bin
on the drive. Copying will not overwrite an existing file; Surge tells you if the name is
already taken.

For safety, Surge's own program files are locked and cannot be renamed or deleted from
here. The file manager only looks inside the Surge folder, never at the rest of the
computer.

## My Notes

Notes are saved on the drive as you type. There is no save button.

- **New note** creates one and puts the cursor in the title.
- The list is sorted by most recently changed, and shows when each note was last edited.
- **Search** looks through both titles and note text.
- Notes support plain text and simple Markdown — headings, bold, italics, lists, links
  and code. Use the preview toggle to see the formatted version.
- **Delete** asks for confirmation.

Notes are stored as ordinary readable files on the drive. Do not keep secrets in Notes;
use the password vault for those.

## Bookmarks

Two things are worth understanding here:

- **Surge bookmarks** are the shortcuts you manage on the homepage.
- **Firefox bookmarks** are the ones in the browser's own bookmarks menu and toolbar.

They are kept separately on purpose. Surge never edits Firefox's bookmark database while
Firefox is running, because doing so can corrupt it.

To move bookmarks between the two:

- **Export for Firefox** writes a file that Firefox can import. In Firefox, open
  Bookmarks ▸ Manage Bookmarks ▸ Import and Backup ▸ Import Bookmarks from HTML.
- **Import** in Surge accepts that same HTML format, so you can bring your existing
  Firefox bookmarks into Surge. It also accepts a Surge JSON export.
- **Export JSON** is a backup of your Surge bookmarks.

Duplicates are skipped when importing, so importing twice will not double everything up.

## Downloads

Firefox is set up to save every download into the `Downloads` folder on your Surge drive,
not onto the computer you are using.

The Downloads section lists those files with their size and date, and lets you open a
file, show it in Explorer, or delete it (with confirmation).

If a download seems to be missing, check that it finished in Firefox first — partial
downloads appear with a `.part` ending until they complete.

## Passwords

The vault is locked every time Surge starts. Nothing is readable until you unlock it.

### First time: creating your vault

1. Open **Passwords** and choose to create a vault.
2. Pick a master password of at least 12 characters. A long phrase of several words is
   both stronger and easier to remember than a short jumble.
3. Confirm that you understand the warning, then create the vault.

**The master password cannot be recovered or reset.** Surge does not store it, does not
send it anywhere, and has no recovery email or hint system. If you forget it, the vault
cannot be opened again — by you or by anyone else. Write it down and keep it somewhere
safe, separate from the drive.

### Day to day

- **Unlock** with your master password. A wrong password simply leaves the vault locked.
- **Add** an entry with a name, username, password and optional website and notes.
- **Reveal** shows a password briefly; **Copy** puts it on the clipboard.
- Copied passwords are cleared from the clipboard automatically after a short delay.
- **Lock** closes the vault immediately. It also locks by itself after a period of no
  activity, which you can change in Settings.

Closing Surge or unplugging the drive also locks the vault.

### What the vault does not do

It does not fill in passwords on websites, and it does not read or change the passwords
Firefox itself has saved. Saving passwords into Firefox is switched off so you do not end
up with two competing password stores.

## Settings

- **Profile & lock screen** — your name on the lock screen, and whether Surge asks for a
  password when the workspace opens.
- **Theme** — dark, light, or follow the computer's setting.
- **Search engine** — which service the homepage search box uses.
- **Vault auto-lock** — how long the vault waits before locking itself.
- **Clipboard clearing** — how long a copied password stays on the clipboard.

Settings live on the drive, so they follow you between computers.

## Shutting down safely

1. Close Firefox.
2. Wait a moment for Surge to finish writing.
3. Use Windows' **Safely Remove Hardware** icon, then unplug the drive.

Pulling the drive out while Surge is running can corrupt your notes, bookmarks or vault.
Surge writes changes carefully and keeps a backup of the previous version, but no software
can guarantee a file that is mid-write when power or the connection disappears.

## Troubleshooting

**Surge says files are missing or damaged.**
The drive may not have copied completely, or `Surge.exe` may have been moved out of the
Surge folder. `Surge.exe` must sit next to the `Browser` and `Interface` folders. Re-copy
the whole Surge folder rather than individual files.

**A banner says the drive was disconnected.**
Surge has stopped writing to protect your data. Reconnect the same drive; Surge should pick
it up again. It will not create replacement folders on the computer.

**My notes or bookmarks reverted to an older version.**
The main file was unreadable, so Surge recovered the last good backup. Your most recent
change may be lost, but the rest is intact.

**The drive letter changed and something broke.**
Surge works out its own location every time it starts, so a different drive letter is
fine. If a shortcut or a pinned path stopped working, it was pointing at the old letter —
recreate it from inside Surge.

**The vault will not open with the password I remember.**
There is no recovery path. Check for a typing mistake, a different keyboard layout, or
Caps Lock. If you have an older copy of the vault file from before a password change, that
copy will open with the older password.

**Downloads are going to the computer instead of the drive.**
This happens if Firefox was started on its own rather than through `Surge.exe`. Close
Firefox and start again from `Surge.exe`.

**The computer is slow or the homepage takes a while.**
USB 2.0 ports and older drives are noticeably slower than USB 3.x. A USB 3 port helps a
lot. Closing unused tabs also reduces memory use.

**Windows or antivirus complains about Surge.**
Surge runs from a removable drive and starts a browser, which some security software
flags. Nothing is installed and no system settings are changed. If your antivirus
quarantines a file, restore it and add an exclusion for the Surge folder.