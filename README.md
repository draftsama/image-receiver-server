# social-face-receiver

To install dependencies:

```bash
bun install
```

To run:

```bash
bun dev
```

## How to deploy new version:
commit tag as `vX.Y.Z` and push it to the repository.

```bash
git tag -a v1.0 -m "v1.0"
```

```bash
git push origin v1.0
```



## Uploading a Content folder

Files sent with a `folder` field are staged in `SAVE_PATH/.incoming/<folder>_<clientId>/`
and stay invisible to the display until the client commits them.

1. Send each file with `POST /upload_file` (or `/upload_image`) and the same `folder` value.
2. Send `POST /commit` with JSON `{"folder": "<folder>", "files": <number of files sent>}`.
   - `200` `{name, local_path}`: the folder was renamed into `SAVE_PATH` as
     `<folder>_<clientId>_<MMdd-HHmmss>` (with `_2`, `_3`, … if that name exists).
   - `409` `{received: [...]}`: the count does not match. Re-send the missing files, then commit again.
   - `404`: nothing is staged for that folder from this client.

`folder` and `prefix_name` must each be a single file name: at most 200 characters, no `/`, `\`,
`..`, leading `.`, control characters, or `<>:"|?*`. Anything else is rejected with `400`.

The commit must come from the same device (same IP and User-Agent) that sent the files.
An upload with no new file for 30 minutes is moved to `SAVE_PATH/failed/`. It is never deleted.

Run the tests with `bun test`.
