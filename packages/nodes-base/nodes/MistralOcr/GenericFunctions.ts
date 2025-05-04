import type {
	IExecuteSingleFunctions,
	IHttpRequestOptions,
	IN8nHttpFullResponse,
	INodeExecutionData,
	JsonObject,
} from 'n8n-workflow';
import { NodeApiError } from 'n8n-workflow';

export async function processResponseData(
	this: IExecuteSingleFunctions,
	items: INodeExecutionData[],
	response: IN8nHttpFullResponse,
): Promise<INodeExecutionData[]> {
	if (!response.body) {
		return items;
	}

	const responseData = response.body as JsonObject;

	return items.map((item) => {
		const newItem = { ...item };

		newItem.json = {
			...newItem.json,
			ocrResult: responseData,
			responseStatusCode: response.statusCode,
			responseDebugInfo: 'Check logs for detailed response information',
		};

		if (responseData.text) {
			newItem.json.extractedText = responseData.text;
		} else if (responseData.pages) {
			const pages = responseData.pages as Array<{ markdown: string; text: string }>;
			newItem.json.extractedText = pages
				.map((page) => page.markdown || page.text || '')
				.join('\n\n');
			newItem.json.pageCount = pages.length;
		}
		if (responseData.processed_file) {
			newItem.binary = {
				...newItem.binary,
				processedDocument: {
					data: responseData.processed_file as string,
					fileName: `processed-${Date.now()}.pdf`,
					mimeType: 'application/pdf',
				},
			};
		}

		return newItem;
	});
}

export async function sendErrorPostReceive(
	this: IExecuteSingleFunctions,
	items: INodeExecutionData[],
	response: IN8nHttpFullResponse,
): Promise<INodeExecutionData[]> {
	if (response.statusCode && response.statusCode >= 400) {
		const inputType = this.getNodeParameter('inputType') as string;
		const parameterName = inputType === 'url' ? 'Document URL' : 'Binary Property';

		const error = response.body as {
			message: string;
			statusMessage: string;
			detail?: Array<{
				loc: string[];
				msg: string;
			}>;
		};

		if (response.statusCode === 422) {
			const errorDetails = error.detail?.map(
				(errorDetail) =>
					`${errorDetail.loc?.join('.') || 'field'}: ${errorDetail.msg || 'Invalid value'}`,
			) ?? ['Invalid request parameters'];

			throw new NodeApiError(this.getNode(), error, {
				message: `The request contains invalid parameters in "${parameterName}"`,
				description: `To fix this, update the following values:\n${errorDetails.join('\n')}\n\nMake sure your input values match the required format and try again.`,
			});
		}

		const message = error.message || response.statusMessage;

		if (message?.toLowerCase().includes('fetching file from url')) {
			// Todo: why get the url from the error body when you have it as node parameter? For example, what if the url starts with http
			const url = message.match(/https?:\/\/[^\s]+/)?.[0] ?? 'the specified URL';

			throw new NodeApiError(this.getNode(), error, {
				message: `Unable to access the document at ${url} in "${parameterName}"`,
				description:
					"To fix this:\n- Confirm the URL is correct and publicly accessible\n- Make sure the document doesn't require authorization\n- Check if the server allows external access\n\nAlternatively, download the file and use the Binary Data option instead.",
			});
		}

		throw new NodeApiError(this.getNode(), error, {
			message: message ?? 'The request to Mistral OCR service was unsuccessful',
			description:
				'To fix this:\n- Double-check your input parameters\n- Verify your API credentials\n- Make sure the Mistral OCR service is available\n- Try a different document or input method',
		});
	}

	return items;
}

export async function handleBinaryData(
	this: IExecuteSingleFunctions,
	requestOptions: IHttpRequestOptions,
): Promise<IHttpRequestOptions> {
	const model = this.getNodeParameter('model') as string;
	const binaryProperty = this.getNodeParameter('binaryProperty') as string;

	const binaryData = this.helpers.assertBinaryData(binaryProperty);
	const binaryDataBuffer = await this.helpers.getBinaryDataBuffer(binaryProperty);
	const base64Data = binaryDataBuffer.toString('base64');
	const dataURL = `data:${binaryData.mimeType};base64,${base64Data}`;

	requestOptions.body = {
		model,
		document: {
			type: 'document_url',
			document_url: dataURL,
		},
	};

	return requestOptions;
}
