import litellm
from callbacks.registry_logger import proxy_handler_instance
if hasattr(litellm, 'callbacks') and isinstance(litellm.callbacks, list):
    litellm.callbacks.append(proxy_handler_instance)
else:
    litellm.callbacks = [proxy_handler_instance]
print("!!! MONKEY PATCHED LITELLM CALLBACKS !!!", flush=True)
