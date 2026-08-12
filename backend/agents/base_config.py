import os
from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(__file__), '../.env'))

def get_llm():
    """
    Returns the LLM identifier string for CrewAI.
    CrewAI uses LiteLLM under the hood, so Ollama models
    are referenced as 'ollama/model_name'.
    """
    model = os.getenv('OLLAMA_MODEL', 'mistral')
    return f"ollama/{model}"