# `notes-editor`

## Motivation

I was finding that Google Docs wasn't cutting it for my notes. In particular:

- There was very limited support for adding diagrams through Apple Pencil
- There was very limited support for LaTeX
- Many ideas are difficult to represent as pure text, and I wanted the ability to map things out as knowledge graphs without having to fiddle around in Google Drawings

Some reasonable alternatives might have been:

- Obsidian: Closed-source and requires a subscription to host on the cloud. I wanted something where even if I didn't have VS Code installed somewhere, I could still access my notes. However, I liked the layout and the directed graphs approach they made.
- Notion: Closed source, doesn't support directed graphs or version control.

To formalize, the **key features** are the following:

- Benefits of Google Docs
  - Persistent, widely-available storage that doesn’t require explicit hosting
  - Centralized place for everything
  - Clear accessibility control over what’s public and private
- Extensibility (interactive elements, version control, LaTeX, directed graphs)
- Portability
  - No proprietary formats. Everything must either be Markdown, Jupyter notebook, or HTML.
  - No technical debt. Easily switch to Obsidian, etc. Basically, just a layer on top of notes.
- Publishability
  - Ability to automatically publish to my website.
  - Interactive elements.
  - Easily share experiments with others, etc.

Basically, I wanted an app that was more tailored to my wants/needs as someone who has lots of ideas and things they want to take notes about.

## Using Michael's Setup

If you do not want to set this up yourself, please send me a message (at `"{0}@{0}{1}.com" % (my first name, my last name)`) with the following:
- A link to a GitHub repo that you have created for the notes. It is recommended that you create a test repo without any sensitive information or notes, so that none of the testing on this application affects your real code.
- A GitHub personal access token with read/write access to that repo. It is recommended that you restrict read/write access exclusively to that repo for testing purposes.
- A passkey that you would like to use for authentication. It is recommended to use four random words separated by hyphens. [Relevant XKCD](https://xkcd.com/936/)
  - Do not use a passkey that you would use for other applications, as the passkey will be seen by me and manually updated to an AWS Lambda function.
  - This will change if there is enough motivation to use GitHub OAuth access, which can replace this method.

## Known Issues

- If you are at the end of a text cell, and you type `$$`, the rest of the document will be converted to a math cell. To fix this, you can type `$$` again, and an empty math cell will be created (representing the empty space between the two `$$`'s that you typed). You can also press ctrl+Z. Note that this will also happen if you type an inline equation and then delete the content between the two single `$`'s.
- Occasionally, the creation of files will fail with a `500` error from the backend. This is still under investigation but has not been reproduced lately.
- Only one file can be edited at a file. **DO NOT SWITCH TO A DIFFERENT FILE WHILE EDITING THE CURRENT ONE**

## Features

- Inline and block form LaTeX
- Rendering of directed graphs

## Desired Features

- Ability to publish files to a separate website.
- `.tex` support (page layout-aware documetns).
- TikZ support.
- Browser-based Python support, for inline interactive content and computations. As a subfeature, support for jax or PyTorch, which is currently limited (unless it can be built through WebAssembly.)

## Self Deployment (Mac)

Currently, instructions are only available for Mac. First install the Amazon Web Services (AWS) CLI and the AWS Serverless Application Model (`sam`) CLI (if not already):

```bash
brew install awscli
brew install aws-sam-cli
```

Then log in to your AWS account (if not already):

```bash
aws configure
```

Then set up the virtual environment:

```bash
pip install uv
uv sync
```

To build the backend environment, run the following from the root of the repository:

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

When you want to push your changes to the cloud, you can use the following:
```bash
sam deploy -g
```

## Technical Details

### Custom Canvas

I created a high-resolution canvas. It supports the Apple Pencil, which one can use while typing at a laptop through Apple's Sidecar feature (which treats the iPad as an external display with touch controls).

#### Image Codec

I wanted images to reasonably fit into Markdown files. To do this, I created a custom image encoding scheme. The resulting images are several factors smaller than PNG files. The format is as follows:

```
uint32: 0x4e 0x4f 0x54 0x45 ("NOTE")
uint8: Version number (0-255).
uint8: Color palette size (0-254).
for each new color in palette:
    uint8's: r, g, b
uint32: number of strokes
for each stroke:
    uint32: length of stroke
    uint8: color ID
    for each point:
        uint16's: x, y
        uint8: thickness
```

The serialization and deserialization code is <160 lines of Javascript. To store in text values, the data is Base64-encoded and then stored as an image tag with `data:` URL ([Mozilla documentation](https://developer.mozilla.org/en-US/docs/Web/URI/Reference/Schemes/data)). This was chosen compared to an alternative of, e.g., creating a code block or XML element, because when viewing the document on any regular Markdown viewer (such as Github or Visual Studio Code), they would include the base64 in the preview, which is undesirable.

#### Apple Pencil API

The Apple Pencil can be integrated with through familiar Javascript events: `touchstart`, `touchmove`, and `touchend`. These include `touchType` properties (which are set to "stylus" if using the Apple Pencil), along with `force` (which are in $[0, 1]$). Additionally, they include `identifier`s, which are unique numbers for given touch events. This allows you to ignore distractor touch events after a first touch has landed on the canvas.

#### Rendering

Strokes are represented as lists of points with thicknesses. Consecutive triplets of points are fit through a quadratic fit, which is thankfully directly built into the HTML Canvas API. When the canvas is not in "edit" mode, the contents of the image are resized to fit the screen, up to a maximum magnification of $4$x.

We do not need to render all strokes during every frame. The canvas maintains a buffer of the content drawn to the screen, and so when *adding* information, we can just keep the existing buffer there. If we want to undo a stroke, however, we must first pop it from our list of strokes and then rerender all previous strokes.

The eraser feature is implemented as a variable color that hypothetically simply takes the color of the background. In practice, it is shown as white. In the image codec, it is stored as the special color palette ID $0$. Black is stored as $1$.

*Attribution*: Some of this code is inspired by [this Github repository](https://github.com/shuding/apple-pencil-safari-api-test).

### Block-Based Markdown Editor

The initial version of the Markdown editor was a side-by-side preview, with one side being a massive text area, and the other side being a rich text preview. However, this results in wasted screen space, and it's a bit tiring to need to scroll through a wall of unrendered plain text. Taking some inspiration from [Notion](https://notion.so/) (which is a very popular note-taking app), I decided to allow single blocks to be editable at a time. This ends up requiring a few tricks to get it working correctly. First of all, there are many things that you expect to be intuitive about working with a text editor that are sort of hard to implement in practice. For example,

- If you are in the middle of a text block and press enter, how does the block split in two? What if you are at the start and press backspace? What if you want to allow pasting content from, e.g., Google Docs or HTML pages?
- If you are in a list, and you press enter, how do you automatically populate the next list element? What if it's a numbered list?
- How do you ensure that the \$\$ symbols used to fence of math equations and such always come in pairs, such as to not break the rest of the document? And similarly for the \`\`\` (triple backticks) used to designate code blocks?
- How do you ensure that the rendering is efficient? (Naïve implementations will result in all blocks being rendered simultaneously, which causes a significant degradation in performance. Slightly less naïve implementations can accidentally trigger re-renders of future blocks.)
- How do you ensure that the content is actually read into blocks correctly?
- How do you represent empty blocks, if Markdown parsers collapse multiple consecutive line breaks into single line breaks?

For these, much of the answer is just that "you need to code all the cases". But there are some ways to simplify the problem space.

First, I normalized all content. First, parse the Markdown using a parser. I use [remarkjs](https://github.com/remarkjs/react-markdown), which is an abstract syntax tree (AST) parser that simultaneously provides a way to directly render Markdown in React. Parsing the AST results in a list of "blocks" as we desire, along with start and end offsets in the Markdown source. I normalize each of the blocks to end with two linebreaks, which makes the layout of the blocks (e.g., start and end offsets) very predictable, reducing a dimension of complexity. Furthermore, I require that text blocks do not have any newlines.

Furthermore, for code and math blocks, once a block becomes a code or math block, its type cannot be changed anymore, and the delimiters (\`\`\` or \$\$) get hidden, meaning they are automatically created or removed in pairs. Otherwise, when trying to delete one of the \$\$ or \`\`\`, the entire rest of the document would transform into a code or math block, which is scary.

To represent empty blocks, I actually just have it be that if the block says the string "(empty)", you can type into it and the string "(empty)" will automatically disappear. If you really want a block to say "(empty)" directly, you could put a backslash in front of one of the parentheses, which would make the source text no longer match.

To make editing and navigation feel natural, I also made it so when you merge two blocks together (say, block A and B), the cursor automatically goes to the index corresponding to the end of block A and before block B. Furthermore, when you press the down arrow and the textarea cursor is at the end of the text, it will automatically switch to the block below, and reset the cursor position to the beginning of the textbox. If you're at the top of a textarea, and you press the up arrow, the editor will switch to the previous block and switch the cursor to point to the end of the content.

To enable high performance, I used [React Scan](https://github.com/aidenybai/react-scan), which was created by Aiden Bai, who is probably the most knowledgeable React developer I have ever seen. This helped me realize that there were unnecessary rerenders in the file tree view and block-based editor. It gave the tip to use `memo()`, which allows you to gate when rerenders occur without using any complicated `useMemo()` hook calls in the parent component. For example, I rerender blocks whenever the following happens: (1) the content of the block changes, (2) the block switches between `editing` and `preview` states, or (3) the index of the block changes. (1) and (2) are easy to think of, but (3) is important because there are callbacks when you press the up or down arrow (to switch which block you're editing) that require knowing the index of the block to function correctly.

For design, I tried to take inspiration from Swiss web design and the [US Graphics Company](https://usgraphics.com/) website. In particular, I wanted everything to be compact, information to be minimal and clear, and text to be monospace where possible to make it feel like you were in some kind of computer mainframe. Additionally, the block-based text editor divides into a grid layout, where there is a central column and each block has a row.

The blocks are organized in a central `BlockEditor` functional React component. This component stores the Markdown source for the entire document, and serves as the source of truth. Whenever a block wants to submit a change, it uses a function handed to it by the `BlockEditor` to do so. This function, when called, slices out the block from the original source, replaces it with the proposed new content, and then updates the state.

### Hosting

One nice thing about this editor is that it has *no database* and *no API server*. To store my content, I use GitHub, which natively provides version control and the ability to leave this app if I don't feel like using it anymore (Markdown being a very portable format). I don't want the public internet to have access to my GitHub API keys, so I use a collection of endpoints written in Python and hosted on AWS. These endpoints are "serverless", which means they use AWS Lambda, which automatically spawns a micro server for a specific request you send. If you don't have a high request volume, you will not have to pay for hosting a server all day and night. Furthermore, you get a gajillion free invokations per month, and the same is true for the GitHub API. So this service is essentially free to self-host. Obsidian has an option for $4/month to do this, but it seems unnecessary compared to just using your own GitHub repo.

To interface with Git, I use `pygit2` (thanks ChatGPT). Git's underlying interface is surprisingly simple to use. Everything is stored in a tree. Nodes in the tree can be directories or files. To add or update a file to your repository, you walk the tree (creating directories if needed) and then insert the *blob* (binary large object) into the tree at the given point. Then, you create a *commit* (which most Git users already know and love) and push the *ref* (which is the pointer to the commit in the commit tree) to the *remote*, which in this case is Github.

I didn't want to look performative so I made most of the commits go to a `dev` branch of my repository. If you commit to the `main` branch on Github, every commit counts towards your public profile stats. But if I make a commit every time I save my notes, and then it would look like I spent all of my time just writing code. lol

### Directed Graphs

One feature I'm a bit excited about is that of directed graphs. These basically can represent trees of goals or reasons for doing something. Ideally, if there's a high level goal and several ways to get there, you should be able to see all the ways to get there as literal paths on the diagram. Or, if you're wanting to figure out what to prioritize when studying, you can write out what topics need what other topics, and then see which topics unlock the most interesting new things. Anyway, it's just a feature I wanted to help organize different machine learning hypotheses and experiments, to keep me grounded in the big picture of things.

#### Specifying Directed Graphs in Natural Language

I didn't want to have to write a whole new language for creating graphs. There are ways to do this, such as the [DOT language in Graphviz](https://graphviz.org/doc/info/lang.html), but this really looks super unnatural and I wanted it to just feel like I was writing in English. So I made it so that each node in the graph has a title, "symbol" (which is meant to be a shorthand, all-lowercase-no-spaces title for the node/concept/etc., sort of like refs in LaTeX), and body. There are two ways to declare a node in the graph. The first is to write a paragraph where you introduce the topic as the first few words of the paragraph. For example, if your paragraph starts with "Soccer is (...)", you could add a string `(@\soccer)` after `Soccer` and then `Soccer` would become a node in the graph. Or, if you wanted to write a bunch of paragraphs about soccer, you could have a heading that says `## Soccer`, and then below it, a text block with the string `(@\soccer)`. Then the text content of the header will become the title of the node, and future blocks up until the next header of equal or lower depth will become the body of the node.

The body of the node gets scanned for strings like `(uses @\symbol1, @\symbol2, ...)` or `(relies on @\symbol1, @\symbol2, ...)`, or any other verb (doesn't have to be `uses` or `relies on`). These verbs will just get shown on the edges at the top of the page.

I'm still finalizing this format but it feels like it should enable you to see how your ideas or experiments all connect to each other, without you really needing to do so explicitly.

#### Rendering the Graphs

I use SVGs to render the graphs. SVGs are super useful tools for website graphics, because they provide most of the flexibility of canvas-like renderers (where you can draw lines, text, polygons, etc.), with the interactability of HTML elements.

Laying out the knowledge graph is actually a bit harder than I thought it would be. My initial strategy was to use $t$-SNE, a method created to help you display large datasets as scatterplots, where nearby points in the scatterplot correspond to similar datapoints. The idea is that this would result in clusters where closely-linked documents would be placed closer together. I adapted the original algorithm to operate on graphs, but this didn't work very well. I also tried to implement my own force-based graph layout, but experienced bugs, and decided to just get a library for this purpose. I decided on [d3-force](https://d3js.org/d3-force). After configuring the attractive force and collision boxes between components, I had a nice little component that let me view concepts as sorts of bubbles floating around in some kind of abstract space of idea. I also added the ability to pan and zoom using the mouse, and to hover over a node to highlight the outgoing edges from it.

## Conclusion

Anyway, that is all I planned to write today. I created this tool over the span of \~4 days. I'm really happy with the progress I made, and I've already found great success in using it for my own note-taking and idea mapping.
