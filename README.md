# `notes-backend`

To install dependencies (only tested on Mac), first install the AWS SAM CLI:

```bash
brew install aws-sam-cli
```

Then set up the virtual environment:

```bash
pip install uv
uv sync
```

To build the backend environment:

```bash
sam build
```

To test locally, create two terminals. In the first terminal, run:

```bash
sam local start-api
```

In the second terminal, run:

```bash
cd frontend
npm run dev
```
