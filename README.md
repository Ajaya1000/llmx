# LLMx

LLMx is task executer system for LLM with [state management](#state-managment). It composes both skills & tool exclusively relavant for a partcular task instance and only provide those context to a LLM agent.It keeps reasoning (Chain of Thhought) in a single execution instance(task) but discards any intermediary resoning steps between tasks. 

The goal is to minimise evergrowing context & reduce context poisoning. It also provides a way to procedurally perform a skill which is currently missing.

## State Managment

Build a AI system with the below componenets

- Executor
- Evaluator
- Skill Retriver
- Skill Proposer
- Wiki Experience across sesssions (failure only?)

The agent harness should

## Skill structure
``` jsonc

    {
        "id": "skill_id",
        "title": "",
        "description": "",
        "body": "",
        "preState": "",
        "postState": "",
        "edges": [
            {
                "id": "edge_id",
                "target": "", // Source skill id,
                // A edge forward description provides information on entering the edge that may help exxecutor bridge the connected skills, and backward description is added to the context on reentering the soure skill.
                //  It's not a failure node.
                "forwardDescription": "",
                "backwardDescription": ""
            }
        ]
 }
```

## Executor


# TODO
- [ ] Current Session history across executor
- [ ] Wiki Across sessions
- [ ] Skill Proposer
- [ ] Workflow support
- [ ] Workflow as another node