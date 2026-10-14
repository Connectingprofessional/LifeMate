# Avatars for the free call

Each avatar is a `.glb` 3D model that has ARKit and Oculus viseme morph targets
(the format used by the TalkingHead library). Add one by copying the file here
and adding an entry to `catalog.json`:

    { "id": "my-avatar", "name": "My avatar", "glb": "my-avatar.glb", "body": "F", "voice": "Puck", "license": "who owns it and on what terms" }

Only add avatars you own or are licensed to use. Ways to make them:
- MPFB (Blender extension, CC0 output) - see the TalkingHead repo, blender/MPFB/MPFB.md
- VRoid Studio (anime style) - see blender/VRoid/VROID.md in the TalkingHead repo
- Microsoft Rocketbox (MIT) after re-rigging

Included: `mpfb.glb`, CC0, created with Blender + MPFB by the TalkingHead project.
Not included on purpose: `brunette.glb` (Ready Player Me, non-commercial licence).
