export interface IRequestBody {
	model: string;
	document?: {
		type: string;
		image_base64?: string;
		document_url?: string;
	};
	documents?: Array<{
		type: string;
		document_url?: string;
		image_base64?: string;
	}>;
}
